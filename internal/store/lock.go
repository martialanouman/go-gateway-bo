package store

import "time"

// Lock décrit un verrouillage en cours. Sa valeur nulle veut dire « aucun verrou », ce qui est le cas
// courant : c'est ce qui permet à l'appelant d'écrire `if lock.Locked()` sans distinguer l'absence.
type Lock struct {
	// Scope dit quelle dimension a verrouillé. Elles sont **cinq** depuis 00009 — l'adresse soumise,
	// l'adresse source, le second facteur, l'enrôlement TOTP et les cérémonies WebAuthn — et ce
	// commentaire en annonçait deux jusqu'à ce que le repli des rédactions le relise.
	Scope string
	// Failures est le compte de cette dimension. Des échecs pour les trois premières, des **appels**
	// pour les deux qu'ajoute 00009, qui bornent des routes réussissant à chaque fois.
	Failures int
	// Remaining est ce qu'il reste à attendre, **calculé par le serveur de base**. Le calculer en Go
	// ferait dépendre le verrou de l'horloge de l'instance qui répond, donc rendrait deux durées
	// différentes pour le même verrou selon l'instance jointe.
	Remaining time.Duration
}

// Locked dit si ce verrou mord encore.
func (l Lock) Locked() bool { return l.Remaining > 0 }

// lockScanner est ce dont la lecture d'un verrou a besoin, et rien de plus. `pgx.Row` et `pgx.Rows`
// le satisfont tous deux, ce qui laisse `scanLock` servir aussi bien la lecture à une ligne que le
// curseur des deux dimensions du premier facteur.
type lockScanner interface {
	Scan(dest ...any) error
}

// scanLock lit les trois colonnes que rend toute requête de verrou et compose le `Lock`.
//
// **La conversion en `time.Duration` est la seule arithmétique de temps qui se fasse en Go**, et elle
// ne consulte aucune horloge : la base a déjà mesuré la durée restante contre la sienne, et il ne
// reste qu'à changer d'unité. Elle était écrite **cinq** fois avant ce repli, sur les trois types qui
// lisaient un verrou ; c'est le genre de ligne dont une correction n'atteint qu'un exemplaire.
//
// L'erreur remonte nue : `pgx.ErrNoRows` doit rester reconnaissable par l'appelant, qui seul sait si
// l'absence de ligne est un cas normal, et lui seul sait aussi nommer la dimension dans son message.
func scanLock(row lockScanner) (Lock, error) {
	var (
		lock    Lock
		seconds float64
	)

	if err := row.Scan(&lock.Scope, &lock.Failures, &seconds); err != nil {
		return Lock{}, err
	}

	lock.Remaining = time.Duration(seconds * float64(time.Second))

	return lock, nil
}
