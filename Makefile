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
dev:
	@echo "→ BFF sur :3001, client sur http://localhost:3000"
	@set -a; [ -f .env ] && . ./.env; set +a; \
	trap 'kill 0' EXIT INT TERM; \
	$(GO) run ./cmd/dashboard & $(PNPM) dev & wait

## build — client puis binaire (step-002 embarquera le premier dans le second)
build:
	$(PNPM) build
	$(GO) build -o $(BINARY) ./cmd/dashboard

## test — Go (unitaires + godog, avec -race) puis client (Vitest)
test:
	$(GO) test -race ./...
	$(PNPM) test

## lint — golangci-lint puis Biome
lint:
	$(GOLANGCI_LINT) run
	$(PNPM) lint

## lint-workflows — actionlint : un workflow invalide est absent, pas rouge
lint-workflows:
	$(ACTIONLINT)

## fmt — formate les deux moitiés
fmt:
	$(GO) fmt ./...
	$(PNPM) format

## typecheck — tsc sur la moitié client
typecheck:
	$(PNPM) typecheck

## vuln — govulncheck et pnpm audit
vuln:
	$(GO) tool govulncheck ./...
	$(PNPM) vuln

## mock — Prism sert le contrat de la passerelle sur :4010
mock:
	$(PNPM) mock

## check — tout ce que la CI vérifie, sur les deux moitiés
check: fmt-check vet tidy-check typecheck lint lint-workflows test vuln build

vet:
	$(GO) vet ./...

# `go fmt` réécrit ; en vérification on veut un échec, pas une correction
# silencieuse qui rendrait la CI verte sur un dépôt mal formaté.
fmt-check:
	@unformatted="$$(gofmt -l cmd internal)"; \
	if [ -n "$$unformatted" ]; then echo "non formaté :"; echo "$$unformatted"; exit 1; fi

tidy-check:
	$(GO) mod tidy -diff

.PHONY: help dev build test lint lint-workflows fmt typecheck vuln mock check vet fmt-check tidy-check
