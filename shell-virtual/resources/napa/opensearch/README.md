# opensearch (operations)

Índice de ejemplo en OpenSearch para exponer operaciones vía Kafka Connect.

- Conexión: `http://opensearch:9200` (seguridad deshabilitada en local).
- Índice: `operations`.
- Campos clave: `operationId` (PK), `updatedAt` (timestamp incremental usado por el conector).
- Volumen: datos mínimos de demo (ver `resources/napa/seeds/opensearch/operations.ndjson`), pensado para pruebas funcionales.
- Modo de captura: polling por timestamp (`updatedAt`) usando el conector Elasticsearch/OpenSearch Source.
- Dependencias: inicializar el índice y datos con `virt opensearch seed-operations` antes de registrar el conector.
