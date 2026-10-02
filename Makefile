# Rental Tracker — everyday commands.  Run `make` to list them.
#
# Thin wrappers around the npm scripts, node and docker, so the commands in
# README.md / CLAUDE.md stay the source of truth. Written for the GNU make 3.81
# that ships with macOS, so no .ONESHELL or other newer features.

SHELL         := /bin/bash
.DEFAULT_GOAL := help

APP_DIR    := app.web
PORT       ?= 8099
DATA       ?= $(CURDIR)/$(APP_DIR)/data
TZ_NAME    ?= Europe/London
IMAGE      ?= rental-tracker
CONTAINER  ?= rental-tracker-dev
SMOKE_PORT ?= 18099
BACKUP_DIR ?= $(HOME)/rental-tracker-backups
# What the app reports as its build: the nearest git tag, e.g. 1.1.1-3-gce64642-dirty.
VERSION    ?= $(shell git describe --tags --always --dirty 2>/dev/null | sed 's/^v//')
ifeq ($(VERSION),)
VERSION := dev
endif

.PHONY: help install hooks setup run dev open \
        verify syntax lint lint-fix selfcheck test \
        docker-build docker-run docker-stop docker-logs docker-smoke \
        backup release clean

help: ## Show this list
	@awk 'BEGIN {FS = ":.*## "} \
		/^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } \
		/^[a-zA-Z_-]+:.*## / { printf "  \033[36m%-13s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo

##@ Setup
install: ## Install dev tooling (ESLint) — the app itself has no dependencies
	npm install

hooks: ## Run `make verify`'s checks before every commit (once per clone)
	npm run hooks

setup: install hooks ## install + hooks, for a fresh clone

##@ Run locally
run: ## Start the app on http://localhost:8099 with app.web/data
	cd $(APP_DIR) && PORT=$(PORT) APP_VERSION=$(VERSION) node server.js

dev: ## Same, restarting whenever server.js or public/ changes
	cd $(APP_DIR) && PORT=$(PORT) APP_VERSION=$(VERSION) \
		node --watch-path=server.js --watch-path=public server.js

open: ## Open the running app in the browser
	@open "http://localhost:$(PORT)" 2>/dev/null || xdg-open "http://localhost:$(PORT)"

##@ Checks
verify: ## Everything the pre-commit hook and CI run: syntax, lint, selfcheck, tests
	npm run verify

syntax: ## node --check on the server and the self check
	npm run syntax

lint: ## ESLint, including the inline scripts in index.html
	npm run lint

lint-fix: ## ESLint with --fix
	npm run lint:fix

selfcheck: ## Invariant checks — the ones that guard against a wrong number
	npm run selfcheck

test: ## Boot the real server on a temp data dir and drive it over HTTP
	npm test

##@ Docker
docker-build: ## Build the image, stamped with the git version
	docker build --build-arg APP_VERSION=$(VERSION) \
		-t $(IMAGE):$(VERSION) -t $(IMAGE):dev $(APP_DIR)

docker-run: docker-build ## Run the image on 127.0.0.1:8099 with app.web/data mounted
	-@docker rm -f $(CONTAINER) >/dev/null 2>&1
	docker run -d --name $(CONTAINER) \
		-p 127.0.0.1:$(PORT):8099 \
		-v "$(DATA)":/data \
		-e TZ=$(TZ_NAME) \
		$(IMAGE):dev
	@echo "→ http://localhost:$(PORT)   (make docker-logs / make docker-stop)"

docker-stop: ## Stop and remove the local container
	-docker rm -f $(CONTAINER)

docker-logs: ## Follow the local container's logs
	docker logs -f $(CONTAINER)

docker-smoke: docker-build ## Boot the image with no data and check it serves, like CI does
	@docker rm -f $(CONTAINER)-smoke >/dev/null 2>&1 || true
	@docker run -d --name $(CONTAINER)-smoke -p 127.0.0.1:$(SMOKE_PORT):8099 $(IMAGE):dev >/dev/null
	@for i in $$(seq 1 30); do \
		  if curl -fsS http://127.0.0.1:$(SMOKE_PORT)/api/data >/dev/null 2>&1; then \
		    echo "container answered after $${i}s"; \
		    curl -fsS http://127.0.0.1:$(SMOKE_PORT)/ | grep -qi '<html' && echo "app shell served"; \
		    docker rm -f $(CONTAINER)-smoke >/dev/null; exit 0; \
		  fi; sleep 1; \
		done; \
		echo "container never answered on /api/data"; docker logs $(CONTAINER)-smoke; \
		docker rm -f $(CONTAINER)-smoke >/dev/null; exit 1

##@ Data & releases
backup: ## Archive app.web/data to ~/rental-tracker-backups (outside the repo)
	@test -d "$(DATA)" || { echo "no data dir at $(DATA)"; exit 1; }
	@mkdir -p "$(BACKUP_DIR)"
	@out="$(BACKUP_DIR)/rental-data-$$(date +%Y%m%d-%H%M%S).tar.gz"; \
		tar -czf "$$out" -C "$(dir $(DATA))" "$(notdir $(DATA))" && echo "backed up → $$out"

release: ## Verify and tag a release locally: make release V=1.2.0 (push the tag to publish)
	@test -n "$(V)" || { echo "usage: make release V=1.2.0"; exit 1; }
	@echo "$(V)" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$$' || { echo "V must look like 1.2.0"; exit 1; }
	@test -z "$$(git status --porcelain)" || { echo "working tree not clean — commit first"; exit 1; }
	@! git rev-parse -q --verify "refs/tags/v$(V)" >/dev/null || { echo "tag v$(V) already exists"; exit 1; }
	$(MAKE) verify
	git tag -a "v$(V)" -m "v$(V)"
	@echo "Tagged v$(V). Publishing the image is a deliberate step:"
	@echo "  git push origin v$(V)"

clean: ## Remove node_modules and local images (never touches data)
	rm -rf node_modules
	-docker image rm $$(docker image ls -q $(IMAGE)) 2>/dev/null
