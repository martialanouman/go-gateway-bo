# Les cibles granulaires (`test-go`, `lint-go`…) existent pour que les jobs de CI n'invoquent jamais
# une cible qui dépend de l'autre toolchain : quatre des cinq jobs Go n'ont ni pnpm ni `node_modules`
# — « Tests Go » est l'exception — et une cible composite les enverrait chercher un `pnpm` absent.
#
# Aucune cible vide ici : une cible qui ne fait rien passe pour verte.

BIN := bin/dashboard
WEBASSETS := internal/webassets/dist

# Le contrat de l'API Admin est consommé depuis GitHub Packages et **jamais copié ici** : la
# génération le lit là où pnpm l'a installé. `internal/gateway/contrat_test.go` en fait une porte.
# C'est ce chemin qui range `generate` du côté qui a les deux toolchains.
CONTRACT_ADMIN := web/node_modules/@martialanouman/gateway-api-contracts/openapi-admin.yaml
ADMIN_CLIENT := internal/gateway/client.gen.go

# Le contrat du BFF, lui, est **écrit ici** et versionné. Il n'a donc aucune garde de présence — un
# arbre où il manque est un arbre abîmé, pas un arbre où `pnpm install` n'a pas tourné.
CONTRACT_BFF := api/openapi-bff.yaml
BFF_SERVER := internal/bff/bff.gen.go

# L'autre moitié qui dérive du même fichier. Le binaire installé, jamais `npx` — même raison que
# `$(PRISM)` plus bas. Il vit sous `web/node_modules/`, donc il exige `pnpm install`.
BFF_TYPES := web/src/lib/api.gen.ts
OPENAPI_TS := web/node_modules/.bin/openapi-typescript

# La troisième sortie qui dérive de `$(CONTRACT_BFF)` : les bornes que `$(BFF_TYPES)` jette en ne
# gardant que la forme. Le générateur est du **Go pur**, comme `$(PERMISSIONS_TS)`, mais il naît
# quand même dans `generate` et non dans une cible à part : sa source est le contrat, qui vit ici.
CONTRACT_ZOD := web/src/lib/contract.gen.ts

# La seule sortie engendrée qui ne dérive **pas** d'un contrat OpenAPI : sa source est du Go, sous
# `internal/permissions/`. Elle n'exige donc ni `node_modules` ni le contrat, d'où sa propre cible
# plus bas — mais elle entre dans la même liste, que `check-generated` tient.
PERMISSIONS_TS := web/src/lib/permissions.gen.ts

# Ce que `check-generated` supprime, régénère et compare. Une liste plutôt qu'un fichier : le jour où
# une step en ajoute un, l'oublier ici le laisserait diverger sans que rien ne rougisse.
GENERATED := $(ADMIN_CLIENT) $(BFF_SERVER) $(BFF_TYPES) $(PERMISSIONS_TS) $(CONTRACT_ZOD)

# Le mock de l'API Admin, et le port que `.env.example` vise avec `DASHBOARD_GATEWAY_BASE_URL`. Le
# binaire installé, jamais `npx`, qui repaierait une résolution de paquet à chaque lancement — le
# premier est prêt en ~1,0 s. Les scénarios godog de `internal/gateway` lancent le même binaire, sur
# un port libre.
PRISM := web/node_modules/.bin/prism
MOCK_PORT := 4010

# Purge ce que la copie précédente a déposé, en épargnant `.gitkeep`.
#
# Rien ne vide `$(WEBASSETS)` — contrairement à `web/dist`, que Vite vide à chaque build. Les noms
# d'assets portent un hash du contenu, donc une nouvelle version n'écrase pas l'ancienne : sans
# purge, les assets de tous les builds précédents s'accumuleraient dans le binaire. `.gitkeep` est
# épargné plutôt que supprimé puis recréé : c'est lui qui rend `//go:embed all:dist` satisfiable sur
# un clone neuf.
#
# Le `test -n` n'est pas une précaution de style. `find` **sans chemin**, sur les findutils GNU
# d'ubuntu-latest, prend le répertoire courant — la racine du dépôt — et supprime tout ce qui ne
# s'appelle pas `.gitkeep`, en rendant 0 ; le `find` de macOS, lui, refuse. La recette est
# destructrice et tourne à la racine : la garde couvre le `make clean WEBASSETS=`.
#
# **Aucune porte ne rougit si cette ligne disparaît** — ni la garde, ni la purge elle-même, vérifié
# en retirant chacune des deux : le binaire continue de servir les bons assets, simplement
# accompagnés des périmés, et le contrôle CI ne regarde que la coquille et un asset qu'elle
# référence. La preuve est manuelle : déposer un `assets/perime-000000.js`, lancer `make build`,
# constater qu'il a disparu.
PURGE_WEBASSETS := test -n "$(WEBASSETS)" && find $(WEBASSETS) -mindepth 1 ! -name .gitkeep -delete

# Le répertoire absent est un arbre de travail abîmé, pas un état de départ : `.gitkeep` est commité,
# et sans lui `//go:embed all:dist` ne compile plus. Les deux recettes qui purgent nomment le remède
# au lieu de laisser `find` rendre « No such file or directory ».
RESTORE_WEBASSETS := echo "$(WEBASSETS) a disparu — le rétablir : git checkout -- $(WEBASSETS)/.gitkeep"

.DEFAULT_GOAL := help
.PHONY: help build build-go build-web dev check test test-go test-web lint lint-go lint-web fmt-go \
        typecheck-web vuln-go vuln-web lint-workflows check-routes generate check-generated mock \
        migrate bootstrap clean generate-permissions e2e

# Trois courses vivent entre les prérequis de `check` ; la deuxième ne se voit pas, la troisième est
# la seule à rougir d'elle-même :
#
# 1. `build` et `check-routes` lancent chacun un `vite build` sur le même `web/dist`, que Vite vide
#    avant d'écrire. Une sortie tronquée, ou un `check-routes` qui juge un arbre à moitié réécrit.
# 2. `build` copie dans `$(WEBASSETS)` pendant que le harnais godog de `test-go` y met en scène ses
#    propres fixtures d'assets, puis les retire. La copie peut se terminer dans cette fenêtre, et le
#    `go build` embarque alors la coquille du harnais — qui porte le même titre que la vraie. Rien ne
#    distingue les deux à l'œil, et toutes les portes restent vertes.
# 3. `check-generated` supprime `$(GENERATED)` avant de le régénérer — absent le temps d'un
#    `make generate` — pendant que `test-go`, `lint-go`, `vuln-go` et `build` compilent `./...`, et
#    que `typecheck-web` lit `$(BFF_TYPES)`. Celle-ci est **bruyante** : `undefined:
#    ClientWithResponses` côté Go, `error TS2307: Cannot find module './api.gen'` côté client.
#
# Le prérequis est **omis**. `.NOTPARALLEL: check` n'honore ses prérequis qu'à partir de GNU make 4.4 ;
# la 3.81 que livre macOS l'accepte sans rien dire et sérialise le run entier de toute façon. La forme
# nue décrit donc ce qui se passe réellement sur les deux versions, au lieu de laisser croire que la
# portée est locale.
#
# Le prix est la perte du parallélisme sur **toutes** les cibles, `make -j check` compris. Assumé :
# la CI lance déjà les portes en jobs parallèles — c'est là que le temps se gagne, pas ici.
#
# **Aucune porte ne rougit si cette ligne disparaît** : les courses qu'elle ferme sont intermittentes
# par nature, et un test qui les déclencherait à coup sûr serait un test de `make -j`, pas du produit.
# Vérifié en la retirant, sur un `make check` **sans `-j`** — que make sérialise de toute façon. Cette
# vérification ne dit donc rien du cas `-j`, qui est précisément celui que la directive couvre.
.NOTPARALLEL:

help: ## Liste les cibles disponibles
	@grep -hE '^[a-z][a-z0-9-]*:.*?## ' $(MAKEFILE_LIST) | awk -F':.*?## ' '{printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# `build-go` est appelé par récursion et non déclaré en prérequis : un prérequis tourne **avant** la
# recette, donc le `go build` compilerait avant la purge et la copie, et embarquerait les assets du
# build précédent. Séquentiellement aussi — `.NOTPARALLEL:` n'y changerait rien.
build: build-web ## Construit le client, l'installe dans le binaire, et compile
	@test -d $(WEBASSETS) || { $(RESTORE_WEBASSETS); exit 1; }
	$(PURGE_WEBASSETS)
	cp -R web/dist/. $(WEBASSETS)/
	@$(MAKE) --no-print-directory build-go

# Compiler sans le client est une cible à part parce que « Build Go », le job qui compile, n'a pas
# pnpm : il appelle `build-go`, jamais `build`, qui l'enverrait chercher un `pnpm` absent.
# (`ubuntu-latest` a Node et npm préinstallés ; c'est bien pnpm, et lui seul, qui manque.)
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
# l'opérateur attend son API. Elle rend aussi le `trap` utile : un shell POSIX n'exécute un
# gestionnaire de signal qu'entre deux commandes, donc attendre `pnpm` en avant-plan avalait le signal
# jusqu'à ce que Vite s'arrête de lui-même.
#
# `build-go` et non `build` : en développement, c'est Vite qui sert le client sur :3000, et le bundle
# de production ne serait embarqué que pour n'être jamais servi.
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

# `build` est ici, et pas `build-go`, pour qu'un vert local dise que le **déployable** se construit :
# c'est le seul endroit qui exerce la purge et la copie avant un push.
#
# Le client s'y construit deux fois, une pour `build` et une pour `check-routes`, pour deux sorties
# identiques. Le surcoût mesuré est de **~0,65 s** par invocation, dominé par le démarrage de Node et
# de pnpm et non par le bundle.
check: build lint-go test-go vuln-go lint-workflows typecheck-web lint-web test-web vuln-web check-routes check-generated ## Toutes les portes de la CI

test: test-go test-web ## Les deux suites

lint: lint-go lint-web ## Les deux linters

# Trois paquets exigent un PostgreSQL. Sans rien, chacun monte son conteneur — c'est le repli, et il
# ne demande qu'un Docker joignable. Avec `DASHBOARD_TEST_DATABASE_URL`, les trois partagent le
# serveur qu'elle désigne, ce que fait la CI :
#
#   docker compose up -d postgres
#   DASHBOARD_TEST_DATABASE_URL=postgres://dashboard:dashboard@localhost:5432/dashboard?sslmode=disable \
#     make test-go
#
# Sur un serveur qui survit aux suites, les bases de test s'accumuleraient : chaque suite jette à son
# démarrage celles qu'un run **fini** a laissées sous son préfixe. Le compte reste donc borné à une
# exécution, sans qu'aucune cible n'ait à être lancée à la main.
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

# Hors de `check`, pour deux raisons que la fiche de step-007 arrête (DN-5) : la Definition of Done y
# parle des **deux** suites, et l'inclure imposerait à tout poste d'avoir téléchargé les navigateurs.
# Ce n'est **pas** un conflit de port : `dev` lie 3000 et 3001, les parcours 3101, choisi pour cela.
#
# Ce que la sortie de `check` crée en revanche, et qu'il faut nommer : une **quatrième course**, hors
# de portée du `.NOTPARALLEL:` ci-dessus, qui ne couvre qu'un seul processus `make`. `make e2e` dans
# un terminal et `go test ./cmd/dashboard/` dans un autre se disputent `$(WEBASSETS)` — le second y met
# en scène ses fixtures d'assets pendant que le premier vient d'y copier la sortie de Vite. Le binaire
# embarque alors la coquille du harnais et le parcours échoue en cherchant le squelette. Bruyant dans
# ce sens, silencieux dans l'autre.
#
# Aucun contrôle préalable des navigateurs ici : Playwright échoue de lui-même et imprime le remède.
# Un contrôle de plus dirait la même chose, moins bien.
# Les parcours ont leur base, remise à neuf à chaque passage, et leur compte : le binaire exige une
# session pour rendre la coquille, et la base de développement a déjà un propriétaire dont le mot de
# passe n'est écrit nulle part. Rien d'un secret : l'hôte et les identifiants sont ceux du conteneur
# local et du service de la CI.
E2E_ADMIN_URL = postgres://dashboard:dashboard@127.0.0.1:5432/dashboard?sslmode=disable
E2E_DATABASE_URL = postgres://dashboard:dashboard@127.0.0.1:5432/dashboard_e2e?sslmode=disable
E2E_OPERATOR_EMAIL = parcours@example.test
E2E_OPERATOR_NAME = Opératrice de parcours
E2E_OPERATOR_PASSWORD = Un-mot-de-passe-de-parcours-1

# Le parcours de step-050 lit ses liens d'accès dans Mailpit, jamais reçus pour de vrai : sans
# `docker compose up -d`, il tourne sans SMTP joignable et rougit sur l'attente du mail.
e2e: build ## Parcours Playwright, contre le binaire (:3101)
	@printf '%s' "$(E2E_ADMIN_URL)" | go run ./scripts/e2edb
	@printf '%s' "$(E2E_DATABASE_URL)" | go run ./cmd/migrate
	@printf '%s' "$(E2E_DATABASE_URL)" | \
		DASHBOARD_BOOTSTRAP_OPERATOR_EMAIL='$(E2E_OPERATOR_EMAIL)' \
		DASHBOARD_BOOTSTRAP_OPERATOR_NAME='$(E2E_OPERATOR_NAME)' \
		DASHBOARD_BOOTSTRAP_OPERATOR_PASSWORD='$(E2E_OPERATOR_PASSWORD)' \
		go run ./cmd/bootstrap
	DASHBOARD_E2E_OPERATOR_EMAIL='$(E2E_OPERATOR_EMAIL)' \
		DASHBOARD_E2E_OPERATOR_NAME='$(E2E_OPERATOR_NAME)' \
		DASHBOARD_E2E_OPERATOR_PASSWORD='$(E2E_OPERATOR_PASSWORD)' \
		pnpm -C web e2e

# `pnpm-workspace.yaml` porte tout un appareil de triage — des `overrides` de versions transitives,
# un `ignoreGhsas` justifié avis par avis, une quarantaine des versions fraîches — dont aucune porte
# ne vérifiait qu'il tient encore. Le versant client est la moitié à la plus grosse surface
# transitive.
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
# compile pas. Le fichier est **supprimé** avant d'être reconstruit, et non simplement comparé : une
# comparaison seule reste verte quand plus rien ne le régénère — le générateur retiré de
# `vite.config.ts` passait la porte, l'arbre commité faisant illusion. Sans générateur, le fichier ne
# réapparaît pas, et son absence rougit.
check-routes: ## Vérifie que l'arbre de routes commité est à jour et régénéré
	@rm -f web/src/routeTree.gen.ts
	@$(MAKE) --no-print-directory build-web \
		|| { git checkout -- web/src/routeTree.gen.ts; exit 1; }
	@git diff --quiet HEAD -- web/src/routeTree.gen.ts || { \
		echo "l'arbre de routes régénéré diffère du fichier commité — commiter web/src/routeTree.gen.ts"; \
		git --no-pager diff --stat HEAD -- web/src/routeTree.gen.ts; \
		exit 1; \
	}

# Le contrat de l'API Admin comme le générateur de types TypeScript sont absents d'un arbre où
# `pnpm install` n'a pas tourné, et `oapi-codegen` comme le shell diraient alors seulement qu'ils
# n'ont pas su ouvrir un chemin. Ce que la recette annonce à la place est la sortie de secours.
#
# Cette cible dépend donc des **deux** toolchains, et `check-generated` avec elle : le seul job de la
# CI qui la lance est « Build client et déployable », qui a Go, pnpm et `node_modules`.
generate: ## Engendre tout ce qui dérive d'une source du dépôt : les deux contrats, le catalogue
	@for required in $(CONTRACT_ADMIN) $(OPENAPI_TS); do \
		test -f "$$required" || { \
			echo "$$required est absent — il vient de pnpm : pnpm -C web install"; \
			exit 1; \
		}; \
	done
	go tool oapi-codegen --config api/oapi-codegen.yaml $(CONTRACT_ADMIN)
	go tool oapi-codegen --config api/oapi-codegen-bff.yaml $(CONTRACT_BFF)
	$(OPENAPI_TS) $(CONTRACT_BFF) -o $(BFF_TYPES)
	go run ./cmd/zodgen $(CONTRACT_BFF) $(CONTRACT_ZOD)
	@$(MAKE) --no-print-directory generate-permissions

# Une cible à part, et non trois lignes de plus dans `generate` : celle-ci est du **Go pur**, quand
# la recette ci-dessus s'ouvre sur une garde qui refuse de démarrer sans `pnpm install`. L'y fondre
# obligerait à installer la toolchain JS pour régénérer après l'ajout d'une clé au catalogue. Ce qui
# tient le front Go↔TS n'est de toute façon ni l'une ni l'autre, mais `check-generated`, où
# `$(PERMISSIONS_TS)` entre par `$(GENERATED)`.
#
# Le chemin est passé en **argument** plutôt que codé dans le générateur : il existerait sinon aux
# deux endroits, qui se croiraient d'accord. Et pas par une redirection — `>` tronque la cible avant
# que la commande démarre, donc un générateur qui échoue laisserait un fichier vide après avoir
# détruit l'état précédent.
generate-permissions: ## Engendre les types TS du catalogue de permissions (Go pur, sans pnpm)
	go run ./cmd/permissionsgen $(PERMISSIONS_TS)

# Le client de l'API Admin est engendré et **commité** : quatre des cinq jobs Go de la CI n'ont pas
# `node_modules`, donc pas le contrat, et sans le fichier commité ils ne compileraient plus. Un bump
# du paquet npm sans régénération passerait sinon inaperçu. Le serveur Go et les types TypeScript du
# BFF sont dans la même liste pour une raison voisine : le contrat du BFF est écrit ici, donc rien ne
# bouge sous les pieds du dépôt, mais ce qui en dérive vient d'une **commande** à relancer.
#
# Ce que cette porte ne tient pas, et qui est tenu ailleurs :
#   - l'URL de `servers`, dont dépend pourtant le préfixe sous lequel tout le contrat est servi :
#     aucun des deux générateurs ne la lit. Mesuré, `- url: /api` remplacé par `- url: /v1` → porte
#     **verte**, sorties identiques, et le scénario godog de `cmd/dashboard` rouge sur « le contrat
#     ne décrit pas GET /api/health ». C'est lui qui tient ce lien-là.
#   - une sortie engendrée **éditée à la main sans être indexée** : la porte supprime et régénère
#     avant de comparer, donc elle rétablit l'édition avant de pouvoir la constater. Qui la mesure
#     d'instinct la verra verte et conclura de travers. Ce qui attrape ce cas est `cmd/permissionsgen`,
#     dont un cas compare le fichier **du disque** au rendu du générateur, et `tsc`.
#
# Le fichier est **supprimé** avant d'être reconstruit, jamais seulement comparé, pour la raison
# écrite au-dessus de `check-routes` : configuration renommée, overlay retiré, outil disparu de la
# directive `tool` — le fichier commité fait illusion, et seule son absence rougit.
#
# Le verdict se lit dans `git status` et non dans `git diff HEAD`, et c'est un **échange**. Le gain :
# `git diff` ne connaît que les fichiers suivis, donc un client engendré mais jamais ajouté à l'index
# le laisse muet — la porte serait verte sur un fichier que la CI ne clonera pas, là où
# `git status --porcelain` le rend en `??`. Le coût : un `git` qui échoue — `detected dubious
# ownership`, workspace d'un job `container:` — écrit sur stderr et rend une **sortie vide**, quand
# `git diff --quiet` l'aurait signalé par son code de retour. D'où le code de retour capturé à part
# du contenu : un `test -z` sur la seule substitution rendait la porte **verte** sur un client
# divergent.
#
# Le rétablissement après un échec de génération se fait **fichier par fichier**, et sans étouffer
# ce que git écrit. `git checkout -- <a> <b> <c>` est atomique sur le pathspec : un seul chemin
# inconnu de l'index — la sortie qu'une step vient d'ajouter à `$(GENERATED)` sans l'avoir encore
# commitée — et git refuse le lot entier, en laissant les autres supprimés. La boucle les rétablit
# et laisse git nommer celui qu'il ne peut pas rétablir.
check-generated: ## Vérifie que tout le code engendré et commité est à jour et régénéré
	@rm -f $(GENERATED)
	@$(MAKE) --no-print-directory generate || { \
		for generated in $(GENERATED); do git checkout -- $$generated; done; \
		exit 1; \
	}
	@state=$$(git status --porcelain -- $(GENERATED)) || { \
		echo "git n'a pas rendu l'état de $(GENERATED) — verdict inconnu, pas vert"; \
		exit 1; \
	}; \
	test -z "$$state" || { \
		echo "du code engendré diffère de ce qui est commité — lancer make generate et commiter"; \
		echo "$$state"; \
		exit 1; \
	}

# Le mock sert le contrat **installé**, jamais une copie — même source que `generate`, donc même
# garde : le contrat vient de GitHub Packages et n'existe pas dans un arbre où `pnpm install` n'a pas
# tourné. Prism, lui, est une devDependency du client. C'est cette double dépendance à
# `web/node_modules/` qui range `mock` du côté à deux toolchains, avec `generate`.
#
# Le port est fixe et documenté ici, là où les scénarios godog en prennent un libre : les deux mocks
# tournent donc côte à côte sans se marcher dessus. Un `PRISM_MOCK_BASE_URL` exporté fait réutiliser
# celui-ci par les scénarios plutôt qu'en démarrer un second — c'est ce que la dernière ligne rappelle.
#
# Prism ne s'arrête pas tout seul : la cible occupe son terminal jusqu'à Ctrl-C, comme `dev`.
mock: ## Mock Prism de l'API Admin sur :4010
	@for required in $(PRISM) $(CONTRACT_ADMIN); do \
		test -f "$$required" || { \
			echo "$$required est absent — le mock et le contrat viennent de GitHub Packages : pnpm -C web install"; \
			exit 1; \
		}; \
	done
	@echo "pour que les scénarios réutilisent ce mock : export PRISM_MOCK_BASE_URL=http://127.0.0.1:$(MOCK_PORT)"
	$(PRISM) mock --port $(MOCK_PORT) --host 127.0.0.1 $(CONTRACT_ADMIN)

# Du Go pur, sans le moindre détour par pnpm : c'est ce qui la rend lançable depuis n'importe quel
# job Go de la CI.
#
# Le DSN est lu ici, et `.env` ne fait que **compléter** l'environnement de l'appelant — il ne
# l'écrase pas. C'est le seul endroit du dépôt où l'ordre de précédence décide de *quelle base* on
# modifie : `DASHBOARD_DATABASE_URL=…/staging make migrate` est la forme naturelle, et un
# `set -a; . ./.env` seul la retourne en silence contre la base locale, en affichant
# « appliquée : … » comme si tout allait bien.
#
# Le DSN part ensuite dans un **tube**, jamais en argument : `ps aux` affiche la ligne de commande de
# tout processus de la machine, et `go run` la duplique dans le processus fils. Le lire ici plutôt
# que dans `cmd/migrate` garde `internal/config` seul package à lire l'environnement (§1.8) — le
# Makefile, lui, n'est pas du Go.
#
# `go run` et non le binaire compilé : les migrations ne sont pas sur le chemin de `make dev`, et un
# `bin/` de plus à purger dans `clean` coûterait plus que la seconde de compilation qu'il épargne.
migrate: ## Applique les migrations du schéma du BFF (DASHBOARD_DATABASE_URL)
	@dsn="$$DASHBOARD_DATABASE_URL"; \
	set -a; if [ -f .env ]; then . ./.env; fi; set +a; \
	dsn="$${dsn:-$$DASHBOARD_DATABASE_URL}"; \
	test -n "$$dsn" || { \
		echo "DASHBOARD_DATABASE_URL est vide — sur un poste local, après docker compose up -d :"; \
		echo "  DASHBOARD_DATABASE_URL=postgres://dashboard:dashboard@localhost:5432/dashboard?sslmode=disable"; \
		exit 1; \
	}; \
	printf '%s' "$$dsn" | go run ./cmd/migrate

# Même recette que `migrate`, à la commande près, et **recopiée plutôt que factorisée** : ce qu'un
# `define` économiserait ici est six lignes de shell, contre un niveau d'indirection sur la seule
# recette du dépôt dont l'ordre de précédence décide de quelle base on écrit. La précédence et le
# tube sont ceux de `migrate`, pour les raisons écrites au-dessus d'elle.
#
# `bootstrap` ne dépend pas de `migrate` : ce sont deux gestes que l'exploitant enchaîne lui-même, et
# le refus de `bootstrap` sur un schéma en retard nomme le remède. Les lier ferait migrer une base
# qu'on voulait seulement semer.
bootstrap: ## Sème permissions et rôles, puis crée le compte propriétaire s'il n'y en a aucun
	@dsn="$$DASHBOARD_DATABASE_URL"; \
	set -a; if [ -f .env ]; then . ./.env; fi; set +a; \
	dsn="$${dsn:-$$DASHBOARD_DATABASE_URL}"; \
	test -n "$$dsn" || { \
		echo "DASHBOARD_DATABASE_URL est vide — sur un poste local, après docker compose up -d :"; \
		echo "  DASHBOARD_DATABASE_URL=postgres://dashboard:dashboard@localhost:5432/dashboard?sslmode=disable"; \
		exit 1; \
	}; \
	printf '%s' "$$dsn" | go run ./cmd/bootstrap

# Idempotent jusqu'au bout : un `$(WEBASSETS)` disparu nomme le remède au lieu d'échouer sur un
# `find: … No such file or directory` à mi-nettoyage. Un `clean` qu'on n'ose pas relancer ne nettoie
# plus rien.
clean: ## Supprime les artefacts de build, assets embarqués compris
	rm -rf bin web/dist
	@if [ -d $(WEBASSETS) ]; then $(PURGE_WEBASSETS); else $(RESTORE_WEBASSETS); fi
