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
        typecheck-web vuln-go lint-workflows check-routes clean

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
# `wait` est ce qui rend le `trap` utile : un shell POSIX ne l'exécute qu'entre deux commandes, donc
# attendre `pnpm` en avant-plan avalerait le signal jusqu'à ce que Vite s'arrête de lui-même — vérifié,
# les deux processus survivaient à un `kill`. `wait`, lui, est interrompu par le signal.
dev: build ## Lance le BFF (:3001) et Vite (:3000) côte à côte
	@set -a; if [ -f .env ]; then . ./.env; fi; set +a; \
	./$(BIN) & bff=$$!; \
	pnpm -C web dev & vite=$$!; \
	trap 'kill $$bff $$vite 2>/dev/null || true' EXIT INT TERM; \
	wait $$vite

check: build lint-go test-go vuln-go lint-workflows typecheck-web lint-web test-web check-routes ## Toutes les portes de la CI

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
check-routes: build-web ## Vérifie que l'arbre de routes commité est à jour
	@git diff --quiet -- web/src/routeTree.gen.ts || { \
		echo "l'arbre de routes commité est périmé — commiter web/src/routeTree.gen.ts"; \
		git --no-pager diff --stat -- web/src/routeTree.gen.ts; \
		exit 1; \
	}

clean: ## Supprime les artefacts de build
	rm -rf bin web/dist
