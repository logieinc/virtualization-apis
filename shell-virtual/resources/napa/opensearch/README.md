# OpenSearch Resources

Estructura de recursos OpenSearch separada por API, igual al esquema de `databases/prisma`.

- Conexión local: `http://opensearch:9200` (seguridad deshabilitada en local).
- Datos de operaciones demo (Kafka Connect): `resources/napa/seeds/opensearch/operations.ndjson`.
- Recursos de índice para `api-wallet`:
  - `resources/napa/opensearch/api-wallet/party-index.yaml`
  - `resources/napa/opensearch/api-wallet/seed-party.yaml`
  - `resources/napa/opensearch/api-wallet/operation-index.yaml`
  - `resources/napa/opensearch/api-wallet/seed-operation.yaml`

Comandos ejemplo:

```bash
vir opensearch create-index party --body resources/napa/opensearch/api-wallet/party-index.yaml
vir opensearch load resources/napa/opensearch/api-wallet/seed-party.yaml --index party
vir opensearch create-index operations-2025-12 --body resources/napa/opensearch/api-wallet/operation-index.yaml
vir opensearch load resources/napa/opensearch/api-wallet/seed-operation.yaml
```

`seed-operation.yaml` usa formato con `variables` + `documents` y soporta placeholders `{{vars.X}}` / `${X}` y fechas dinámicas con `{{now}}` (ej: `{{now+5ms}}`).
