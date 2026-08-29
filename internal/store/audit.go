package store

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Fields est l'état qu'une ligne d'audit porte, avant ou après une action.
//
// **On n'y verse que des scalaires, et c'est tout le propos.** Marshaler un type de domaine y ferait
// entrer ce qu'il porte aujourd'hui — un mot de passe haché, un secret de second facteur, un corps de
// message — **et tout ce qu'on lui ajoutera demain**, sans qu'aucune relecture ne le voie. C'est la
// règle du DTO de sortie (§1.11) appliquée à une écriture : un champ absent d'ici ne peut pas y
// entrer, parce qu'il n'existe pas de méthode pour l'y mettre.
//
// Le nil est utilisable : `(*Fields)(nil).JSON()` rend `nil`, donc une action qui ne décrit pas
// d'état laisse la colonne nulle plutôt qu'un objet vide.
type Fields struct {
	values map[string]any
}

// NewFields ouvre un état vide. Les méthodes se chaînent.
func NewFields() *Fields {
	return &Fields{values: map[string]any{}}
}

func (f *Fields) Text(name, value string) *Fields {
	return f.with(name, value)
}

func (f *Fields) Number(name string, value int64) *Fields {
	return f.with(name, value)
}

func (f *Fields) Flag(name string, value bool) *Fields {
	return f.with(name, value)
}

func (f *Fields) with(name string, value any) *Fields {
	if f == nil {
		f = NewFields()
	}

	f.values[name] = value

	return f
}

// JSON rend ce que la colonne `jsonb` recevra, ou `nil` pour un état vide ou absent.
func (f *Fields) JSON() ([]byte, error) {
	if f == nil || len(f.values) == 0 {
		return nil, nil
	}

	encoded, err := json.Marshal(f.values)
	if err != nil {
		return nil, fmt.Errorf("sérialiser l'état d'audit : %w", err)
	}

	return encoded, nil
}

// Event est ce qu'une action laisse au journal.
//
// `OperatorID` vide dit « aucun opérateur » : la colonne l'admet, et un événement système en aura
// besoin. La clé étrangère est en `RESTRICT` — le journal ne perd jamais son auteur, un opérateur
// qui part se désactive plutôt qu'il ne se supprime.
type Event struct {
	OperatorID string
	// Action suit la convention du §3.1 : `domaine.verbe`, par exemple `passkey.remove` ou
	// `mfa.enroll`. Elle se grep dans le journal, donc elle ne se traduit pas.
	Action     string
	TargetType string
	TargetID   string
	Before     *Fields
	After      *Fields
	// IPAddress va en clair, délibérément. Le HMAC des adresses garde `login_attempt_counters`, la
	// seule table qu'une requête **non authentifiée** fait écrire ; le journal, lui, n'est écrit que
	// par des actions authentifiées, et une enquête a besoin de l'adresse telle quelle.
	IPAddress string
}

// Audit écrit le journal. Il ne décide de rien : ce qui doit être tracé, et sous quel nom, est la
// responsabilité de l'appelant.
type Audit struct {
	pool *pgxpool.Pool
}

func NewAudit(pool *pgxpool.Pool) *Audit {
	return &Audit{pool: pool}
}

// Record écrit une ligne hors de toute transaction. C'est la forme des actions **proxyfiées** vers la
// passerelle, qui n'ont pas de transaction commune avec leur audit : l'écriture suit le succès, et
// une panne entre les deux perd la trace. Le trou est réel, il est écrit, et M3 en héritera.
func (a *Audit) Record(ctx context.Context, event Event) error {
	return record(ctx, a.pool, event)
}

// RecordTx écrit dans la transaction de l'action. C'est la forme des actions **locales** : ou les
// deux, ou aucune. C'est ce qui rend la trace non contournable — et c'est aussi pourquoi une
// partition manquante ferait tomber l'action elle-même.
func (a *Audit) RecordTx(ctx context.Context, tx pgx.Tx, event Event) error {
	return record(ctx, tx, event)
}

// writer couvre ce qu'un pool et une transaction ont en commun. Le nommer évite d'écrire la requête
// deux fois — et deux rédactions du même `INSERT` divergeraient sur la colonne qu'on ajouterait.
type writer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

func record(ctx context.Context, w writer, event Event) error {
	before, err := event.Before.JSON()
	if err != nil {
		return err
	}

	after, err := event.After.JSON()
	if err != nil {
		return err
	}

	const query = `
		INSERT INTO audit_log (operator_id, action, target_type, target_id,
		                       before_json, after_json, ip_address)
		VALUES (nullif($1, '')::uuid, $2, nullif($3, ''), nullif($4, ''), $5, $6,
		        nullif($7, '')::inet)`

	_, err = w.Exec(ctx, query, event.OperatorID, event.Action, event.TargetType, event.TargetID,
		before, after, event.IPAddress)
	if err != nil {
		return fmt.Errorf("écrire au journal d'audit : %w", err)
	}

	return nil
}
