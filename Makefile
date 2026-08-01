# Les cibles granulaires (`test-go`, `lint-go`…) existent pour que les jobs de CI n'invoquent jamais
# une cible qui dépend de l'autre toolchain : le job Go n'a ni Node ni `node_modules`, et une cible
# composite l'y enverrait chercher un `pnpm` absent.
#
# Ce que ce fichier ne porte pas encore : `mock` (Prism) et les cibles du versant Go qui n'ont pas
# encore leur code (`generate`, `migrate`, `bootstrap`). Aucune cible vide ici : une cible qui ne fait
# rien passe pour verte.

BIN := bin/dashboard

.DEFAULT_GOAL := help
.PHONY: help build build-web dev check test test-go test-web lint lint-go lint-web fmt-go \
        typecheck-web vuln-go vuln-web lint-workflows check-routes clean

help: ## Liste les cibles disponibles
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk -F':.*?## ' '{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

build: ## Compile le binaire dans bin/ (le client s'y embarque en step-002)
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
dev: build ## Lance le BFF (:3001) et Vite (:3000) côte à côte
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

check: build lint-go test-go vuln-go lint-workflows typecheck-web lint-web test-web vuln-web check-routes ## Toutes les portes de la CI

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
lint-workflows: ## actionlint sur .github/workflows
	go tool actionlint

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

clean: ## Supprime les artefacts de build
	rm -rf bin web/dist
