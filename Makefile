GO             ?= go
PNPM           ?= pnpm -C web
BINARY         ?= bin/dashboard
GOLANGCI_LINT  ?= $(GO) tool github.com/golangci/golangci-lint/v2/cmd/golangci-lint
ACTIONLINT     ?= $(GO) tool github.com/rhysd/actionlint/cmd/actionlint

.DEFAULT_GOAL := help

## help — liste les cibles
help:
	@grep -hE '^## ' $(MAKEFILE_LIST) | sed 's/^## /  /'

## dev — BFF Go (:3001) et client Vite (:3000) en parallèle, /api proxifié
#
# `wait -n` et non `wait` : si l'une des deux moitiés sort, la cible s'arrête et
# rend son code. Avec `wait` nu, un Vite qui refuse de démarrer — ce que
# `strictPort` rend justement bruyant — laissait `make dev` attendre le BFF
# indéfiniment, et l'opérateur voyait un serveur vivant sans client.
dev:
	@echo "→ BFF sur :3001, client sur http://localhost:3000"
	@set -a; [ -f .env ] && . ./.env; set +a; \
	trap 'kill 0' EXIT INT TERM; \
	$(GO) run ./cmd/dashboard & $(PNPM) dev & wait -n

## build — client puis binaire (step-002 embarquera le premier dans le second)
build: build-web build-go

## test — les deux suites
test: test-go test-web

## lint — les deux linters
lint: lint-go lint-web

## check — tout ce que la CI vérifie, sur les deux moitiés
check: fmt-check vet tidy-check lint-workflows lint-go test-go vuln-go build-go \
       typecheck-web lint-web test-web vuln-web build-web verify-squelette

# ─── Moitié Go ────────────────────────────────────────────────────────────────
# Cibles granulaires : les jobs de CI Go n'ont ni Node ni `web/node_modules`, et
# une cible composite les ferait échouer sur `pnpm` avant d'atteindre le Go.

build-go:
	$(GO) build -o $(BINARY) ./cmd/dashboard

test-go:
	$(GO) test -race ./...

lint-go:
	$(GOLANGCI_LINT) run

vuln-go:
	$(GO) tool govulncheck ./...

vet:
	$(GO) vet ./...

tidy-check:
	$(GO) mod tidy -diff

# `go fmt` réécrit ; en vérification on veut un échec, pas une correction
# silencieuse qui rendrait la CI verte sur un dépôt mal formaté.
fmt-check:
	@unformatted="$$(gofmt -l cmd internal)"; \
	if [ -n "$$unformatted" ]; then echo "non formaté :"; echo "$$unformatted"; exit 1; fi

## lint-workflows — actionlint : un workflow invalide est absent, pas rouge
lint-workflows:
	$(ACTIONLINT)

# ─── Moitié client ────────────────────────────────────────────────────────────

build-web:
	$(PNPM) build

test-web:
	$(PNPM) coverage

typecheck-web:
	$(PNPM) typecheck

lint-web:
	$(PNPM) lint

vuln-web:
	$(PNPM) vuln

# Le squelette doit survivre au build **et** rester non bloqué : Vite réécrit
# `index.html`, et c'est l'artefact — pas la source — qui atteint le navigateur.
verify-squelette: build-web
	$(PNPM) exec vitest run --config vitest.artefact.config.ts

## routetree-check — l'arbre de routes commité est-il à jour ?
routetree-check: build-web
	@git diff --exit-code -- web/src/routeTree.gen.ts \
	  || { echo "routeTree.gen.ts est périmé : lancer 'pnpm -C web build' et commiter le fichier"; exit 1; }

## fmt — formate les deux moitiés
fmt:
	$(GO) fmt ./...
	$(PNPM) format

## vuln — les deux scanners
vuln: vuln-go vuln-web

## mock — Prism sert le contrat de la passerelle sur :4010
mock:
	$(PNPM) mock

.PHONY: help dev build test lint check build-go test-go lint-go vuln-go vet tidy-check \
        fmt-check lint-workflows build-web test-web typecheck-web lint-web vuln-web \
        verify-squelette routetree-check fmt vuln mock
