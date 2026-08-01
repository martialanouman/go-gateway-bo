GO     ?= go
BINARY ?= bin/dashboard

.DEFAULT_GOAL := help

## help — liste les cibles
help:
	@grep -hE '^## ' $(MAKEFILE_LIST) | sed 's/^## /  /'

## dev — lance le BFF (step-001 y ajoutera Vite et le proxy /api)
dev:
	$(GO) run ./cmd/dashboard

## build — produit le binaire (step-002 y ajoutera les assets embarqués)
build:
	$(GO) build -o $(BINARY) ./cmd/dashboard

## test — unitaires et scénarios godog
test:
	$(GO) test ./...

## lint — golangci-lint
lint:
	golangci-lint run

## fmt — formate le code
fmt:
	$(GO) fmt ./...

## vuln — govulncheck, épinglé par la directive `tool` de go.mod
vuln:
	$(GO) tool govulncheck ./...

## check — tout ce que la CI vérifie
check: fmt-check vet lint test vuln build

vet:
	$(GO) vet ./...

# `go fmt` réécrit ; en vérification on veut un échec, pas une correction
# silencieuse qui rendrait la CI verte sur un dépôt mal formaté.
fmt-check:
	@unformatted="$$(gofmt -l cmd internal)"; \
	if [ -n "$$unformatted" ]; then echo "non formaté :"; echo "$$unformatted"; exit 1; fi

.PHONY: help dev build test lint fmt vuln check vet fmt-check
