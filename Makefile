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
# **Le binaire, pas `go run`.** `go run` compile puis lance un enfant et ne lui
# relaie aucun signal : tuer son PID laissait le serveur orphelin, PPID 1, en
# écoute sur :3001 — le `make dev` suivant échouait sur « address already in
# use ». `kill 0` couvrait ce cas en frappant le groupe de processus, mais
# frappe aussi le shell appelant hors terminal interactif. Lancer le binaire
# construit fait du PID surveillé celui du serveur, et le problème disparaît au
# lieu d'être contourné.
#
# La boucle rend la main dès qu'une moitié sort, et le `trap` arrête l'autre :
# un Vite qui refuse son port ne laisse plus un BFF vivant sans client.
dev: build-go
	@echo "→ BFF sur :3001, client sur http://localhost:3000"
	@set -a; [ -f .env ] && . ./.env; set +a; \
	./$(BINARY) & bff=$$!; \
	$(PNPM) dev & web=$$!; \
	trap 'kill $$bff $$web 2>/dev/null' EXIT INT TERM; \
	while kill -0 $$bff 2>/dev/null && kill -0 $$web 2>/dev/null; do sleep 1; done; \
	vivant_bff=0; kill -0 $$bff 2>/dev/null && vivant_bff=1; \
	vivant_web=0; kill -0 $$web 2>/dev/null && vivant_web=1; \
	if [ $$vivant_bff = 0 ] && [ $$vivant_web = 0 ]; then echo "→ arrêt des deux moitiés"; exit 0; fi; \
	if [ $$vivant_bff = 1 ]; then echo "→ le client s'est arrêté"; else echo "→ le BFF s'est arrêté"; fi; \
	exit 1

## build — client puis binaire (step-002 embarquera le premier dans le second)
build: build-web build-go

## test — les deux suites
test: test-go test-web

## lint — les deux linters
lint: lint-go lint-web

## check — tout ce que la CI vérifie, sur les deux moitiés
# `verify-squelette` et `routetree-check` déclarent `build-web` en prérequis :
# make ne le refait qu'une fois. `test-web` ne dépend plus de `dist/` depuis que
# `vitest.config.ts` exclut les tests d'artefact — l'ordre ci-dessous est donc
# une commodité de lecture, pas une contrainte, et `make -j` reste libre.
check: fmt-check vet tidy-check lint-workflows lint-go test-go vuln-go build-go \
       typecheck-web lint-web build-web test-web verify-squelette routetree-check vuln-web

# ─── Moitié Go ────────────────────────────────────────────────────────────────
# Cibles granulaires : les jobs de CI Go n'ont ni Node ni `web/node_modules`, et
# une cible composite les ferait échouer sur `pnpm` avant d'atteindre le Go.

# Dépend de `build-web` : le binaire embarque les assets, et compiler sans les
# avoir construits produirait un binaire qui rend 500 sur toute URL.
build-go: build-web
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
	@git diff --quiet HEAD -- web/src/routeTree.gen.ts \
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
