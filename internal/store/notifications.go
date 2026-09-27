package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const NotificationPageSize = 20

var (
	ErrNotificationUnknown = errors.New("notification inconnue")
	ErrNotificationCursor  = errors.New("curseur de notifications illisible")
)

type Notifications struct {
	pool *pgxpool.Pool
}

func NewNotifications(pool *pgxpool.Pool) *Notifications {
	return &Notifications{pool: pool}
}

type NewNotification struct {
	Source   string
	Severity string
	Kind     string
	Details  any
}

type NotificationView struct {
	ID        string
	Source    string
	Severity  string
	Kind      string
	Message   *string
	Details   json.RawMessage
	CreatedAt time.Time
	Read      bool
}

type NotificationPage struct {
	Items       []NotificationView
	NextCursor  string
	UnreadCount int
}

func (n *Notifications) Record(ctx context.Context, fresh NewNotification) (NotificationView, error) {
	var details []byte

	if fresh.Details != nil {
		encoded, err := json.Marshal(fresh.Details)
		if err != nil {
			return NotificationView{}, fmt.Errorf("sérialiser les faits de la notification : %w", err)
		}

		details = encoded
	}

	view := NotificationView{Source: fresh.Source, Severity: fresh.Severity, Kind: fresh.Kind, Details: details}

	err := n.pool.QueryRow(ctx, `
		INSERT INTO notifications (source, severity, kind, details)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text, created_at`,
		fresh.Source, fresh.Severity, fresh.Kind, details).Scan(&view.ID, &view.CreatedAt)
	if err != nil {
		return NotificationView{}, fmt.Errorf("écrire la notification : %w", err)
	}

	return view, nil
}

func (n *Notifications) Page(ctx context.Context, operatorID string, sources []string, cursor string,
) (NotificationPage, error) {
	rows, err := n.pool.Query(ctx, `
		SELECT id::text, source, severity, kind, message, details, created_at,
		       read_by_operators @> jsonb_build_array($1::text)
		FROM notifications
		WHERE source = ANY($2) AND ($3 = '' OR id < $3::uuid)
		ORDER BY id DESC
		LIMIT $4`,
		operatorID, sources, cursor, NotificationPageSize+1)
	if isViolation(err, "22P02") {
		return NotificationPage{}, ErrNotificationCursor
	}

	if err != nil {
		return NotificationPage{}, fmt.Errorf("lire les notifications : %w", err)
	}

	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (NotificationView, error) {
		var view NotificationView
		err := row.Scan(&view.ID, &view.Source, &view.Severity, &view.Kind, &view.Message, &view.Details,
			&view.CreatedAt, &view.Read)

		return view, err
	})
	if isViolation(err, "22P02") {
		return NotificationPage{}, ErrNotificationCursor
	}

	if err != nil {
		return NotificationPage{}, fmt.Errorf("lire les notifications : %w", err)
	}

	page := NotificationPage{Items: items}
	if len(items) > NotificationPageSize {
		page.Items = items[:NotificationPageSize]
		page.NextCursor = page.Items[NotificationPageSize-1].ID
	}

	err = n.pool.QueryRow(ctx, `
		SELECT count(*) FROM notifications
		WHERE source = ANY($2) AND NOT read_by_operators @> jsonb_build_array($1::text)`,
		operatorID, sources).Scan(&page.UnreadCount)
	if err != nil {
		return NotificationPage{}, fmt.Errorf("compter les notifications non lues : %w", err)
	}

	return page, nil
}

// MarkRead n'écrit l'audit que si l'état change : une seconde lecture n'est pas un second geste.
func (n *Notifications) MarkRead(ctx context.Context, operatorID, id string, sources []string, event Event) error {
	return inTx(ctx, n.pool, func(tx pgx.Tx) error {
		var alreadyRead bool

		err := tx.QueryRow(ctx, `
			SELECT read_by_operators @> jsonb_build_array($1::text)
			FROM notifications WHERE id::text = $2 AND source = ANY($3)
			FOR UPDATE`, operatorID, id, sources).Scan(&alreadyRead)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotificationUnknown
		}

		if err != nil {
			return fmt.Errorf("lire la notification : %w", err)
		}

		if alreadyRead {
			return nil
		}

		if _, err = tx.Exec(ctx, `
			UPDATE notifications SET read_by_operators = read_by_operators || jsonb_build_array($1::text)
			WHERE id::text = $2`, operatorID, id); err != nil {
			return fmt.Errorf("marquer la notification lue : %w", err)
		}

		event.TargetID = id

		return record(ctx, tx, event)
	})
}
