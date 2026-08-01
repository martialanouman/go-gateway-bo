GO             ?= go
BINARY         ?= bin/dashboard
GOLANGCI_LINT  ?= $(GO) tool github.com/golangci/golangci-lint/v2/cmd/golangci-lint
ACTIONLINT     ?= $(GO) tool github.com/rhysd/actionlint/cmd/actionlint

.DEFAULT_GOAL := help

## help — liste les cibles
help:
	@grep -hE '^## ' $(MAKEFILE_LIST) | sed 's/^## /  /'

## dev — lance le BFF en chargeant .env (step-001 y ajoutera Vite et le proxy /api)
dev:
	@set -a; [ -f .env ] && . ./.env; set +a; $(GO) run ./cmd/dashboard

## build — produit le binaire (step-002 y ajoutera les assets embarqués)
build:
	$(GO) build -o $(BINARY) ./cmd/dashboard

## test — unitaires et scénarios godog, avec le détecteur de courses
test:
	$(GO) test -race ./...

## lint — golangci-lint
lint:
	$(GOLANGCI_LINT) run

## lint-workflows — actionlint : un workflow invalide est absent, pas rouge
lint-workflows:
	$(ACTIONLINT)

## fmt — formate le code
fmt:
	$(GO) fmt ./...

## vuln — govulncheck
vuln:
	$(GO) tool govulncheck ./...

## check — tout ce que la CI vérifie
check: fmt-check vet tidy-check lint lint-workflows test vuln build

vet:
	$(GO) vet ./...

# `go fmt` réécrit ; en vérification on veut un échec, pas une correction
# silencieuse qui rendrait la CI verte sur un dépôt mal formaté.
fmt-check:
	@unformatted="$$(gofmt -l cmd internal)"; \
	if [ -n "$$unformatted" ]; then echo "non formaté :"; echo "$$unformatted"; exit 1; fi

tidy-check:
	$(GO) mod tidy -diff

.PHONY: help dev build test lint lint-workflows fmt vuln check vet fmt-check tidy-check
