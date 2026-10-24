DB_URL ?= postgres://postgres:postgres_password@localhost:5432/temu_market?sslmode=disable
D1_DB_NAME ?= openmarket-db

.PHONY: infra-up infra-down gen-api build test migrate-d1-local deploy-all

infra-up:
	docker compose -f infra/docker-compose.yml up -d

infra-down:
	docker compose -f infra/docker-compose.yml down

gen-api:
	npx @redocly/cli bundle docs/openapi/openapi.yaml -o docs/openapi/bundled.yaml
	npx openapi-typescript docs/openapi/bundled.yaml -o packages/types/api-schema.d.ts

build:
	npm run build

test:
	cd backend && go test -v ./...

migrate-d1-local:
	for f in migrations/d1_*.sql; do npx wrangler d1 execute $(D1_DB_NAME) --local --file="$$f"; done

deploy-all:
	npm run build
	npm run deploy:api
	npm run deploy:storefront
	npm run deploy:partner
	npm run deploy:admin
