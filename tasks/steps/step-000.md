# step-000 — Socle Go : module, binaire, configuration, arrêt propre

> **Jalon :** M0 (§1.3, §1.8, §4.1) · **Statut :** À FAIRE
> **Dépend de :** — · **Bloque :** tout

## But
Un module Go qui compile, démarre, refuse bruyamment une configuration incomplète, et s'arrête
proprement. C'est le squelette dans lequel tout le reste se branche — il ne sert encore aucune page.

## Périmètre (ce que fait CETTE PR)
- `go.mod` avec la version de Go figée, `cmd/dashboard/main.go`, et l'arborescence `internal/` vide
  mais créée : `bff/ auth/ gateway/ hub/ alerting/ store/ permissions/`.
- Routeur `chi` monté sur `/api`, avec pour l'instant une seule route : `GET /api/health`.
- **Configuration par variables d'environnement, validée au démarrage** (§1.8). Un secret manquant
  arrête le process avec un message qui nomme la variable — jamais une valeur par défaut silencieuse.
- **Arrêt propre** : `SIGTERM` ferme le serveur HTTP avec un délai de grâce, le `context` racine est
  annulé, et le process rend la main.
- `Makefile` : `dev`, `build`, `check`, plus les cibles que les steps suivantes complèteront.
- `.env.example` documenté, `.gitignore`, `golangci-lint` configuré.
- CI GitHub Actions : job Go (build, vet, lint, test).

## Points d'implémentation clés
- **`internal/` porte l'invariant (d) par construction** : le langage interdit qu'un module extérieur
  l'importe. Ce n'est pas une règle de lint, c'est une erreur de compilation — d'où le choix de tout
  y mettre plutôt que sous `pkg/`.
- La configuration est un struct validé **une fois**, passé par injection. Aucun `os.Getenv` ailleurs
  que dans le chargeur — sinon une variable manquante se découvre au premier appel, en production.
- Le `context` racine est créé dans `main` et descend partout. Toute goroutine future s'arrête sur son
  annulation ; c'est la convention qui rendra le hub WS testable (§1.6 du plan).
- `GET /api/health` ne touche ni la base ni la passerelle : c'est une sonde de vivacité, pas de
  disponibilité. La sonde de disponibilité arrive en step-186.

## Tests (écrits dans la même PR)
- **Scénario** `configuration.feature` : *Étant donné* une variable de configuration obligatoire
  absente, *Quand* le serveur démarre, *Alors* il s'arrête et le message nomme la variable.
- Unitaire : le chargeur refuse une URL malformée, un port hors bornes, un délai négatif.
- **Arrêt propre** : une requête en vol au moment du `SIGTERM` se termine ; une requête entrante après
  le `SIGTERM` est refusée. Sans ce test, le déploiement roulant de step-186 n'a aucun filet.

## Definition of Done
- [ ] `make check` vert (build · vet · lint · test)
- [ ] `.env.example` liste **toutes** les variables lues, et rien de plus — vérifié par un test
- [ ] la mutation « retirer la validation d'une variable obligatoire » fait rougir la suite

## Hors périmètre
Le client SPA → step-001. `embed.FS` → step-002. La base → step-005. Toute route métier.
