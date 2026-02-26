# =============================================================================
# UMZH-Connect COW Sandbox — Makefile
# =============================================================================

.PHONY: help up down reset seed logs ps shell-backend shell-frontend test e2e dev

COMPOSE = docker compose
ENV_FILE = .env

help:
	@echo ""
	@echo "UMZH-Connect COW Sandbox"
	@echo "========================="
	@echo ""
	@echo "  make up          Start all services (builds if needed)"
	@echo "  make down        Stop all services"
	@echo "  make reset       Stop, remove volumes, restart clean"
	@echo "  make seed        Load FHIR seed data into HAPI FHIR"
	@echo "  make logs        Tail logs for all services"
	@echo "  make ps          Show running containers"
	@echo "  make test        Run backend unit + integration tests"
	@echo "  make e2e         Run end-to-end test script"
	@echo "  make dev         Start with hot-reload dev overrides"
	@echo ""

# Copy .env if it doesn't exist
$(ENV_FILE):
	@test -f $(ENV_FILE) || (cp .env.example $(ENV_FILE) && echo "Copied .env.example → .env (review & adjust secrets)")

up: $(ENV_FILE)
	$(COMPOSE) up -d --build
	@echo ""
	@echo "Services starting up. Endpoints:"
	@echo "  Frontend:    http://localhost:3000"
	@echo "  Backend API: http://localhost:8000/docs"
	@echo "  Keycloak:    http://localhost:8180/admin  (admin/admin)"
	@echo "  HAPI FHIR:   http://localhost:8282/fhir/metadata"
	@echo "  KrakenD A:   http://localhost:8484"
	@echo "  KrakenD B:   http://localhost:8485"

down:
	$(COMPOSE) down

reset:
	$(COMPOSE) down -v --remove-orphans
	$(COMPOSE) up -d --build

seed:
	@echo "Seeding FHIR resources..."
	docker exec backend python -m app.scripts.seed_fhir

logs:
	$(COMPOSE) logs -f

ps:
	$(COMPOSE) ps

shell-backend:
	docker exec -it backend bash

shell-frontend:
	docker exec -it frontend sh

test:
	docker exec backend pytest tests/ -v

e2e:
	bash scripts/e2e_test.sh

dev: $(ENV_FILE)
	$(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml up -d --build
