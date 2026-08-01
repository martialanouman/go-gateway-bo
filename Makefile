# Les cibles granulaires (`test-go`, `lint-go`…) existent pour que les jobs de CI n'invoquent jamais
# une cible qui dépend de l'autre toolchain : le job Go n'a ni Node ni `node_modules`, et une cible
# composite l'y enverrait chercher un `pnpm` absent.
#
# Ce que ce fichier ne porte pas encore : les composites `test` et `lint` ; les cibles qui passent par
# Node (`test-web`, `lint-web`, et `mock`, qui lance Prism) ; et celles du versant Go qui n'ont pas
# encore leur code (`generate`, `migrate`, `bootstrap`). Aucune cible vide ici : une cible qui ne fait
# rien passe pour verte.

BIN := bin/dashboard

.DEFAULT_GOAL := help
.PHONY: help build dev check test-go lint-go fmt-go vuln-go lint-workflows clean

help: ## Liste les cibles disponibles
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk -F':.*?## ' '{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

build: ## Compile le binaire dans bin/
	go build -o $(BIN) ./cmd/dashboard

# `exec` sur le binaire compilé, et non `go run` : `go run` ne relaie aucun signal à son enfant, donc
# un Ctrl-C laisse un orphelin qui tient le port. Le serveur Vite s'ajoutera ici en step-001.
dev: build ## Lance le BFF avec les variables de .env
	@set -a; if [ -f .env ]; then . ./.env; fi; set +a; exec ./$(BIN)

check: build lint-go test-go vuln-go lint-workflows ## Toutes les portes de la CI (moitié Go)

test-go: ## Tests Go et scénarios godog, avec -race
	go test -race ./...

lint-go: ## golangci-lint
	go tool golangci-lint run ./...

fmt-go: ## Applique le formatage
	go tool golangci-lint fmt ./...

vuln-go: ## Vulnérabilités connues des dépendances Go
	go tool govulncheck ./...

# Un workflow invalide n'est pas rouge, il est **absent** : la protection de branche n'a alors plus
# rien à exiger, et une PR passe sans qu'aucune porte n'ait tourné.
lint-workflows: ## actionlint sur .github/workflows
	go tool actionlint

clean: ## Supprime les artefacts de build
	rm -rf bin
