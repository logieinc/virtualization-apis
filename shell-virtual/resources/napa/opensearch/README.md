# OpenSearch Resources

Estructura de recursos OpenSearch separada por API, igual al esquema de `databases/prisma`.

- Conexión local: `http://opensearch:9200` (seguridad deshabilitada en local).
- Datos de operaciones demo (Kafka Connect): `resources/napa/seeds/opensearch/operations.ndjson`.
- Recursos de índice para `api-wallet`:
  - `resources/napa/opensearch/api-wallet/party-index.yaml`
  - `resources/napa/opensearch/api-wallet/seed-party.yaml`
  - `resources/napa/opensearch/api-wallet/operation-index.yaml`
  - `resources/napa/opensearch/api-wallet/seed-operation.yaml`
- Recursos de índice para `api-data-virtual`:
  - `resources/napa/opensearch/api-data-virtual/players-index.yaml`
  - `resources/napa/opensearch/api-data-virtual/seed-players.yaml`
  - `resources/napa/opensearch/api-data-virtual/player-netwin-daily-index.yaml`
  - `resources/napa/opensearch/api-data-virtual/seed-player-netwin-daily.yaml`
  - `resources/napa/opensearch/api-data-virtual/player-bets-index.yaml`

Comandos ejemplo:

```bash
vir opensearch create-index party --body resources/napa/opensearch/api-wallet/party-index.yaml
vir opensearch load resources/napa/opensearch/api-wallet/seed-party.yaml --index party
vir opensearch create-index operations-2025-12 --body resources/napa/opensearch/api-wallet/operation-index.yaml
vir opensearch load resources/napa/opensearch/api-wallet/seed-operation.yaml
```

`seed-operation.yaml` usa formato con `variables` + `documents` y soporta placeholders `{{vars.X}}` / `${X}` y fechas dinámicas con `{{now}}` (ej: `{{now+5ms}}`).

## Bootstrap rápido para api-data-virtual

```bash
vir opensearch create-index players-affiliations-v1 --body resources/napa/opensearch/api-data-virtual/players-index.yaml
vir opensearch load resources/napa/opensearch/api-data-virtual/seed-players.yaml

vir opensearch create-index player-netwin-daily-v1 --body resources/napa/opensearch/api-data-virtual/player-netwin-daily-index.yaml
vir opensearch load resources/napa/opensearch/api-data-virtual/seed-player-netwin-daily.yaml

vir opensearch create-index player-bets-v1 --body resources/napa/opensearch/api-data-virtual/player-bets-index.yaml
```
