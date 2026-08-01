# Les cibles granulaires (`test-go`, `lint-go`…) existent pour que les jobs de CI n'invoquent jamais
# une cible qui dépend de l'autre toolchain : le job Go n'a ni pnpm ni `node_modules`, et une cible
# composite l'y enverrait chercher un `pnpm` absent.
#
# Ce que ce fichier ne porte pas encore : `mock` (Prism) et les cibles du versant Go qui n'ont pas
# encore leur code (`migrate`, `bootstrap`). Aucune cible vide ici : une cible qui ne fait rien passe
# pour verte.

BIN := bin/dashboard
WEBASSETS := internal/webassets/dist

# Le contrat de l'API Admin est consommé depuis GitHub Packages et **jamais copié ici** : la
# génération le lit là où pnpm l'a installé. `internal/gateway/contrat_test.go` en fait une porte.
#
# C'est ce chemin qui range `generate` — et la porte qui la rejoue — du côté qui a les deux
# toolchains : le versant Go n'a ni pnpm ni `node_modules`, et une cible de génération invoquée par un
# job Go ne trouverait pas le contrat. Même raison que `build-go` face à `build`.
CONTRACT_ADMIN := web/node_modules/@martialanouman/gateway-api-contracts/openapi-admin.yaml
ADMIN_CLIENT := internal/gateway/client.gen.go

# Purge ce que la copie précédente a déposé, en épargnant `.gitkeep`.
#
# Rien ne vide `$(WEBASSETS)` — contrairement à `web/dist`, que Vite vide à chaque build. Les noms
# d'assets portent un hash du contenu, donc une nouvelle version n'écrase pas l'ancienne : sans
# purge, les assets de tous les builds précédents s'accumuleraient dans le binaire.
#
# `.gitkeep` est épargné plutôt que supprimé puis recréé : c'est lui qui rend `//go:embed all:dist`
# satisfiable sur un clone neuf, et le défaut a déjà été payé une fois — les trois lignes du
# `.gitignore` et `internal/webassets/webassets_test.go` existent pour ça.
#
# Le `test -n` n'est pas une précaution de style. `find` **sans chemin**, sur les findutils GNU
# d'ubuntu-latest, prend le répertoire courant — la racine du dépôt — et supprime tout ce qui ne
# s'appelle pas `.gitkeep`, en rendant 0 ; le `find` de macOS, lui, refuse. Aucune surcharge légitime
# ne vide cette variable, mais la recette est destructrice et tourne à la racine : la garde coûte
# quatre mots et couvre le `make clean WEBASSETS=` que personne n'a voulu taper.
#
# **Aucune porte ne rougit si cette ligne disparaît** — ni la garde, ni la purge elle-même : le binaire
# continue de se compiler et de servir les bons assets, simplement accompagnés des périmés, et le
# contrôle CI ne regarde que la coquille et un asset qu'elle référence. Vérifié plutôt que supposé, en
# retirant chacune des deux et en relançant `make check`. La preuve est manuelle : déposer un
# `assets/perime-000000.js`, lancer `make build`, constater qu'il a disparu.
PURGE_WEBASSETS := test -n "$(WEBASSETS)" && find $(WEBASSETS) -mindepth 1 ! -name .gitkeep -delete

# Le répertoire absent est un arbre de travail abîmé, pas un état de départ : `.gitkeep` est commité,
# et sans lui `//go:embed all:dist` ne compile plus. Les deux recettes qui purgent le disent au lieu
# de laisser `find` rendre « No such file or directory » sans indiquer la sortie de secours.
RESTORE_WEBASSETS := echo "$(WEBASSETS) a disparu — le rétablir : git checkout -- $(WEBASSETS)/.gitkeep"

.DEFAULT_GOAL := help
.PHONY: help build build-go build-web dev check test test-go test-web lint lint-go lint-web fmt-go \
        typecheck-web vuln-go vuln-web lint-workflows check-routes generate check-generated clean

# Deux courses vivent entre les prérequis de `check`, et la seconde ne se voit pas :
#
# 1. `build` et `check-routes` lancent chacun un `vite build` sur le même `web/dist`, que Vite vide
#    avant d'écrire. Une sortie tronquée, ou un `check-routes` qui juge un arbre à moitié réécrit.
# 2. `build` copie dans `$(WEBASSETS)` pendant que le harnais godog de `test-go` y met en scène ses
#    propres fixtures d'assets, puis les retire. La copie peut se terminer dans cette fenêtre, et le
#    `go build` embarque alors la coquille du harnais — qui porte le même titre que la vraie. Rien ne
#    distingue les deux à l'œil, et toutes les portes restent vertes.
#
# Le prérequis est **omis**. `.NOTPARALLEL: check` n'honore ses prérequis qu'à partir de GNU make 4.4 ;
# la 3.81 que livre macOS l'accepte sans rien dire et sérialise le run entier de toute façon. La forme
# nue décrit donc ce qui se passe réellement sur les deux versions, au lieu de laisser croire que la
# portée est locale. Mesuré ici sur make 3.81 : deux cibles de 2 s sous `-j4` prennent 4,1 s avec la
# directive, 2,1 s sans — elle est bien appliquée.
#
# Le prix est la perte du parallélisme sur **toutes** les cibles, `make -j check` compris. Assumé : le
# seul mur que `-j` raccourcissait est celui des dix portes de `check`, et la CI les lance déjà en
# jobs parallèles — c'est là que le temps se gagne, pas ici. Un `make -j` qui produit un binaire faux
# une fois sur dix coûte plus cher que la minute qu'il fait gagner.
#
# **Aucune porte ne rougit si cette ligne disparaît** : la course qu'elle ferme est intermittente par
# nature, et un test qui la déclencherait à coup sûr serait un test de `make -j`, pas du produit.
# Vérifié en la retirant — `make check` reste vert.
.NOTPARALLEL:

help: ## Liste les cibles disponibles
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk -F':.*?## ' '{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# `build-go` est appelé par récursion et non déclaré en prérequis, et ce n'est pas qu'une affaire de
# `-j` : un prérequis tourne **avant** la recette, dans tous les cas. Déclaré en prérequis, le
# `go build` compilerait avant la purge et la copie, et embarquerait les assets du build précédent —
# séquentiellement aussi, `.NOTPARALLEL:` n'y changerait rien.
build: build-web ## Construit le client, l'installe dans le binaire, et compile
	@test -d $(WEBASSETS) || { $(RESTORE_WEBASSETS); exit 1; }
	$(PURGE_WEBASSETS)
	cp -R web/dist/. $(WEBASSETS)/
	@$(MAKE) --no-print-directory build-go

# Compiler sans le client est une cible à part parce qu'aucun des cinq jobs Go de la CI n'a pnpm ni
# `node_modules` : celui qui compile appelle `build-go`, jamais `build`, qui l'enverrait chercher un
# `pnpm` absent. (`ubuntu-latest` a Node et npm préinstallés — vérifié au manifeste des images
# `actions/runner-images` ; c'est bien pnpm, et lui seul, qui manque.)
#
# Le binaire qui en sort n'a pas d'interface — le `.gitkeep` commité suffit à `//go:embed`, et c'est
# la compilation qu'on vérifie là-bas, pas le déployable.
build-go: ## Compile le binaire dans bin/, sans reconstruire le client
	go build -o $(BIN) ./cmd/dashboard

build-web: ## Construit le client dans web/dist
	pnpm -C web build

# Deux processus en développement, un seul en production. Vite proxifie `/api` et `/ws` vers le BFF,
# donc le développement emprunte le même chemin que la production.
#
# Le binaire compilé est lancé, jamais `go run` : `go run` ne relaie aucun signal à son enfant, et un
# Ctrl-C laisserait un orphelin tenant le port. Les deux PID sont retenus explicitement et un `trap`
# les termine — ni `wait -n`, absent du `/bin/sh` de macOS, ni `kill 0`, qui frapperait tout le groupe
# de processus, shell appelant compris.
#
# La boucle de scrutation surveille les **deux** : un `wait` sur le seul Vite laissait le BFF mourir en
# silence, et le proxy servait alors ce qui traînait sur le port — un serveur étranger répond 404 là où
# l'opérateur attend son API. C'est le miroir du défaut que `strictPort` empêche côté Vite.
#
# Elle rend aussi le `trap` utile : un shell POSIX n'exécute un gestionnaire de signal qu'entre deux
# commandes, donc attendre `pnpm` en avant-plan avalait le signal jusqu'à ce que Vite s'arrête de
# lui-même — vérifié, les deux processus survivaient à un `kill`.
#
# `build-go` et non `build` : en développement, c'est Vite qui sert le client sur :3000. Construire un
# bundle de production pour l'embarquer dans un binaire qui ne le servira pas coûte deux secondes à
# chaque lancement et ne change rien à ce que l'opérateur voit.
dev: build-go ## Lance le BFF (:3001) et Vite (:3000) côte à côte
	@set -a; if [ -f .env ]; then . ./.env; fi; set +a; \
	./$(BIN) & bff=$$!; \
	pnpm -C web dev & vite=$$!; \
	stopping=0; \
	trap 'stopping=1; kill $$bff $$vite 2>/dev/null || true' INT TERM; \
	trap 'kill $$bff $$vite 2>/dev/null || true' EXIT; \
	while kill -0 $$bff 2>/dev/null && kill -0 $$vite 2>/dev/null; do sleep 1; done; \
	[ "$$stopping" = 1 ] && exit 0; \
	kill -0 $$bff 2>/dev/null \
		&& echo 'Vite s'\''est arrêté.' \
		|| echo 'le BFF s'\''est arrêté : Vite aurait servi un proxy sans destination.'; \
	exit 1

# `build` est ici, et pas `build-go`, pour qu'un vert local dise que le **déployable** se construit.
# Depuis que le job « Build client et déployable » de la CI a Go et lance `make build`, ce n'est plus
# le seul endroit qui exerce la purge et la copie — mais c'est le seul avant un push.
#
# Le client s'y construit deux fois, une pour `build` et une pour `check-routes`, pour deux sorties
# identiques. Le surcoût mesuré est de **~0,65 s** — trois `pnpm -C web build` à 0,64 · 0,65 · 0,61 s,
# et 0,63 s cache de Vite vidé, sur darwin/arm64 avec un store pnpm chaud ; le runner Linux paie le
# même double build, à son propre tarif.
#
# Ce commentaire annonçait « ~100 ms » : c'était le « built in » que Vite imprime (94-121 ms pour ce
# bundle de 275 Ko), pris pour le coût d'une invocation — que le démarrage de Node et de pnpm domine.
#
# La sérialisation des prérequis est portée par le `.NOTPARALLEL:` du haut de fichier, qui dit
# pourquoi.
check: build lint-go test-go vuln-go lint-workflows typecheck-web lint-web test-web vuln-web check-routes check-generated ## Toutes les portes de la CI

test: test-go test-web ## Les deux suites

lint: lint-go lint-web ## Les deux linters

test-go: ## Tests Go et scénarios godog, avec -race
	go test -race ./...

lint-go: ## golangci-lint
	go tool golangci-lint run ./...

typecheck-web: ## tsc --noEmit sur le client
	pnpm -C web typecheck

lint-web: ## Biome
	pnpm -C web lint

test-web: ## Vitest
	pnpm -C web test

# `pnpm-workspace.yaml` porte tout un appareil de triage — `ignoreGhsas: []`, deux `overrides` — dont
# aucune porte ne vérifiait qu'il tient encore. Le versant client est la moitié à la plus grosse
# surface transitive.
vuln-web: ## Avis de sécurité des dépendances client
	pnpm -C web vuln

fmt-go: ## Applique le formatage
	go tool golangci-lint fmt ./...

vuln-go: ## Vulnérabilités connues des dépendances Go
	go tool govulncheck ./...

# Un workflow invalide n'est pas rouge, il est **absent** : la protection de branche n'a alors plus
# rien à exiger, et une PR passe sans qu'aucune porte n'ait tourné.
#
# La seconde vérification est de la même famille : la protection de branche n'exige que le check `CI`,
# qui agrège les autres par son `needs:`. Un job absent de cette liste échouerait sans bloquer la PR.
lint-workflows: ## actionlint, et l'agrégateur CI attend-il tous les jobs ?
	go tool actionlint
	python3 scripts/check-ci-aggregator.py

# L'arbre de routes est engendré par le plugin TanStack et **commité** : sans lui, un clone frais ne
# compile pas. Le régénérer et constater qu'il n'a pas bougé est la seule façon de savoir que le
# fichier commité correspond aux routes présentes.
# Le fichier est **supprimé** avant de reconstruire, et non simplement comparé : une comparaison seule
# reste verte quand plus rien ne le régénère — le générateur retiré de `vite.config.ts` passait la
# porte, l'arbre commité faisant illusion. Sans générateur, le fichier ne réapparaît pas, et son
# absence rougit.
check-routes: ## Vérifie que l'arbre de routes commité est à jour et régénéré
	@rm -f web/src/routeTree.gen.ts
	@$(MAKE) --no-print-directory build-web \
		|| { git checkout -- web/src/routeTree.gen.ts; exit 1; }
	@git diff --quiet HEAD -- web/src/routeTree.gen.ts || { \
		echo "l'arbre de routes régénéré diffère du fichier commité — commiter web/src/routeTree.gen.ts"; \
		git --no-pager diff --stat HEAD -- web/src/routeTree.gen.ts; \
		exit 1; \
	}

# Le contrat est absent d'un arbre où `pnpm install` n'a pas tourné, et `oapi-codegen` dirait alors
# seulement qu'il n'a pas su ouvrir un chemin. Ce que la recette annonce à la place est la sortie de
# secours.
generate: ## Engendre le client Go de l'API Admin depuis le contrat installé
	@test -f $(CONTRACT_ADMIN) || { \
		echo "$(CONTRACT_ADMIN) est absent — le contrat vient de GitHub Packages : pnpm -C web install"; \
		exit 1; \
	}
	go tool oapi-codegen --config api/oapi-codegen.yaml $(CONTRACT_ADMIN)

# Le client de l'API Admin est engendré et **commité** : les jobs Go de la CI n'ont pas
# `node_modules`, donc pas le contrat, et sans le fichier commité ils ne compileraient plus.
# Le régénérer et constater qu'il n'a pas bougé est la seule façon de savoir que ce qui est commité
# correspond au contrat installé — un bump du paquet npm sans régénération passerait sinon inaperçu.
#
# Même forme que `check-routes`, et pour la même raison : le fichier est **supprimé** avant d'être
# reconstruit, jamais seulement comparé. Une comparaison seule reste verte quand plus rien ne
# régénère — configuration renommée, overlay retiré, outil disparu de la directive `tool` — le
# fichier commité faisant illusion. Sans génération, il ne réapparaît pas, et son absence rougit.
#
# Le verdict se lit dans `git status` et non dans `git diff HEAD`, seule différence de forme avec
# `check-routes` : `git diff` ne connaît que les fichiers suivis, donc un client engendré mais jamais
# ajouté à l'index le laisse muet — la porte serait verte sur un fichier que la CI ne clonera pas.
# `git status --porcelain` le rend en `??`, au même titre qu'une modification ou une suppression.
check-generated: ## Vérifie que le client de l'API Admin commité est à jour et régénéré
	@rm -f $(ADMIN_CLIENT)
	@$(MAKE) --no-print-directory generate \
		|| { git checkout -- $(ADMIN_CLIENT) 2>/dev/null; exit 1; }
	@test -z "$$(git status --porcelain -- $(ADMIN_CLIENT))" || { \
		echo "le client régénéré diffère du fichier commité — lancer make generate et commiter $(ADMIN_CLIENT)"; \
		git --no-pager status --short -- $(ADMIN_CLIENT); \
		exit 1; \
	}

# Idempotent jusqu'au bout. La version précédente supprimait `bin` et `web/dist`, puis échouait sur
# un `find: … No such file or directory` quand `$(WEBASSETS)` avait disparu : un nettoyage à moitié
# fait, un code 1, et rien qui indique la sortie de secours. Un `clean` qu'on n'ose pas relancer ne
# nettoie plus rien.
clean: ## Supprime les artefacts de build, assets embarqués compris
	rm -rf bin web/dist
	@if [ -d $(WEBASSETS) ]; then $(PURGE_WEBASSETS); else $(RESTORE_WEBASSETS); fi
