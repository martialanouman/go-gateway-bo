package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PartitionRefresh est l'intervalle auquel les partitions d'`audit_log` sont réclamées.
//
// Un jour, et non un mois : ce qui compte n'est pas la fréquence mais la garantie qu'un passage ait
// lieu **avant** le premier du mois. Un intervalle mensuel calé sur l'heure de démarrage passerait à
// côté d'un redémarrage le 31, et un intervalle horaire n'achèterait rien qu'un jour ne donne déjà.
const PartitionRefresh = 24 * time.Hour

// EnsureAuditPartitions crée les partitions d'`audit_log` du mois courant et du suivant.
//
// **La migration 00002 ne les crée qu'une fois**, à son application, et goose ne rejoue jamais une
// migration appliquée. Mesuré en step-005 : une base migrée en août ne porte que les partitions
// d'août et de septembre, et la première écriture d'octobre est refusée par
// `no partition of relation "audit_log" found for row`. Comme l'audit partage la transaction de
// l'action qu'il trace, c'est l'action métier qui tombe — sans que rien n'ait prévenu.
//
// La fonction SQL est idempotente (`CREATE TABLE IF NOT EXISTS`) : deux instances qui démarrent
// ensemble ne se gênent pas, et un appel de plus ne coûte qu'un aller-retour.
func EnsureAuditPartitions(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, "SELECT ensure_audit_log_partitions()"); err != nil {
		return fmt.Errorf("créer les partitions du journal d'audit : %w", err)
	}

	return nil
}

// KeepAuditPartitions rappelle EnsureAuditPartitions jusqu'à l'annulation du contexte.
//
// **Un appel au démarrage ne suffit pas.** Il couvre le déploiement ; il ne couvre pas un process
// qui tourne des mois — c'est-à-dire un produit stable qu'on ne redéploie plus, le meilleur moment
// pour tomber. Élargir la fenêtre de la fonction SQL à douze mois est explicitement refusé par la
// migration 00002 : cela déplacerait la date de la panne au lieu de créer ce qui manque.
//
// `report` reçoit ce qui échoue. Un échec n'arrête pas la boucle : la base peut être momentanément
// injoignable, et abandonner alors laisserait le produit sans partitions au mois suivant, sans que
// rien n'ait dit pourquoi. C'est l'appelant qui décide quoi faire du rapport — ce paquet ne connaît
// aucun journal.
func KeepAuditPartitions(ctx context.Context, pool *pgxpool.Pool, every time.Duration,
	report func(error),
) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := EnsureAuditPartitions(ctx, pool); err != nil && ctx.Err() == nil {
				report(err)
			}
		}
	}
}
