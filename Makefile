DB_URL ?= postgres://postgres:postgres_password@localhost:5432/temu_market?sslmode=disable

.PHONY: infra-up infra-down gen-api

infra-up:
    docker compose -f infra/docker-compose.yml up -d

infra-down:
    docker compose -f infra/docker-compose.yml down

gen-api:
    npx @redocly/cli bundle docs/openapi/openapi.yaml -o docs/openapi/bundled.yaml
    npx openapi-typescript docs/openapi/bundled.yaml -o web/packages/shared/src/api-schema.d.ts
