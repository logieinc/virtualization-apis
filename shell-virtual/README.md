## Shell Virtual CLI

Herramienta en Node.js/TypeScript para cargar datos en OpenSearch, Postgres y MongoDB desde la línea de comandos.

> Este módulo se creó copiando la estructura de `shell-affiliations`. Ajustá los comandos y endpoints según el contexto de virtualización.

### Requisitos

- Node.js 20 o superior.
- OpenSearch corriendo y accesible (por defecto en `http://localhost:9200`).
- Postgres disponible (por defecto via Docker Compose en `virtualization-apis`).

### Instalación y enlace rápido

```bash
# Instalar dependencias
npm install

# Compilar los archivos TypeScript a dist/
npm run build

# Registrar el binario localmente. Esto expone tres comandos: `shell-virtual`, `vir` (alias corto) y `virt` (compatibilidad).
npm link
```

El CLI se configura con un archivo YAML por ambientes.  
También podés ejecutar el CLI sin compilar usando `npm run dev -- <comando>` mientras desarrollás.

### Configuración por ambientes (YAML)

El CLI lee un archivo YAML en el directorio actual:

- `virt.config.yaml` / `virt.config.yml`
- `.virt.yaml` / `.virt.yml`
- `.env.yaml` / `.env.yml`

Ejemplo: `virt.config.example.yaml` (incluido).  
Selecciona el environment con `--env <nombre>`.

Cuando `postgres.mode` es `direct`, el CLI usa `psql` del host (requiere tenerlo instalado).
Si definís `databases.<nombre>`, podés elegir el destino con `--target <nombre>`; si el nombre de la DB coincide, se usa automáticamente.

### Comandos principales

Una vez enlazado (`npm link`), usá el alias corto:

```bash
vir <comando> [opciones]
```

### Comandos MongoDB

```bash
vir mongo <comando> [opciones]
```

#### 1. Listar colecciones

```bash
vir mongo list-collections
```

#### 2. Insertar documentos

```bash
vir mongo insert party resources/model/party/data.yaml
```

#### 3. Buscar documentos

```bash
vir mongo find party
vir mongo find party --filter resources/model/party/filter.yaml --limit 5
vir mongo find party --filter resources/model/party/filter.yaml --table --fields id,name,type
```

#### 4. Eliminar documentos

```bash
vir mongo delete party 64e9c9e4f9c2c6a1b2c3d4e5
vir mongo delete party --filter resources/model/party/filter.yaml
vir mongo delete party --filter resources/model/party/filter.yaml --yes
```

- Requiere escribir `DELETE` para confirmar (usa `--yes` para omitirla).

#### 4.1 Limpiar todas las colecciones de una base

```bash
vir mongo delete-all
vir mongo delete-all --yes
vir mongo delete-all --include-system --yes
```

- Borra documentos en todas las colecciones de la base seleccionada.
- Por defecto excluye colecciones `system.*`.

#### 5. Exportar documentos

```bash
vir mongo export party --format json
vir mongo export party --format yaml --output resources/model/party/data.yaml
```

---

### Comandos Postgres

```bash
vir postgres <comando> [opciones]
```

> Si ejecutas el CLI fuera de `virtualization-apis`, usa `--compose-dir` o `COMPOSE_DIR` para ubicar el `docker-compose.yml`.

#### Configuración (`virt.config.yaml`)

El archivo `virt.config.yaml` define los environments y cómo conectarse a los servicios.

- Estructura mínima:

```yaml
default: local
variables:
  # Variables reutilizables para placeholders ${VAR}
  PG_HOST_STG: stg-db.example.com
environments:
  local:
    apiUrl: http://localhost:4000
    paths:
      workspace: ./resources
    postgres:
      mode: compose # compose | direct
      service: postgres
      user: postgres
      adminDb: postgres
      composeDir: ../
    databases:
      api_wallet:
        mode: compose
        service: postgres-wallet
        user: postgres
        adminDb: postgres
        composeDir: ../
    opensearch:
      url: http://localhost:9200
    mongo:
      url: mongodb://mongo:mongo@localhost:27017/?authSource=admin
      db: virtual
  stg:
    apiUrl: https://api.example.com
    postgres:
      mode: direct
      host: ${PG_HOST_STG}
      port: 5432
      user: ${PG_USER_STG}
      password: ${PG_PASSWORD_STG}
      adminDb: postgres
```

- `adminDb`: nombre de la base administrativa usada para conectarse (no es la password).
- `password`: solo aplica en modo `direct`. En modo `compose`, la password la toma del contenedor (`POSTGRES_PASSWORD` en `docker-compose.yml`).
- `port`: en modo `compose` no se usa para los comandos (se ejecuta dentro del contenedor), pero es útil para mantener la config consistente.
- `mode`:
  - `compose`: el CLI se conecta usando `docker compose exec` dentro del contenedor. No necesita `host`/`password` porque usa los del container.
  - `direct`: el CLI se conecta por red a un Postgres externo. Requiere `host`, `port`, `user` y `password`.

#### 1. Crear una base individual (opcionalmente con drop + schema)

```bash
vir postgres create-db api_wallet --schema-dir resources/napa/seeds/postgres/sql
vir postgres create-db api_wallet --drop --yes --schema-file /ruta/schema.sql
vir postgres create-db api_wallet --schema-file resources/napa/databases/prisma/api-wallet/schema.prisma
vir postgres create-db api_wallet --target api_wallet --schema-dir resources/napa/seeds/postgres/sql
```

- Si usas `--drop` sin `--yes`, pide confirmación escribiendo `DELETE`.

#### 2. Dropear una base individual

```bash
vir postgres drop-db api_wallet --yes
vir postgres drop-db api_wallet --target api_wallet --yes
```

- Si no usas `--yes`, pide confirmación escribiendo `DELETE`.

#### 3. Limpiar datos de una base (sin dropear schema)

```bash
vir postgres clean-db api_wallet --yes
vir postgres clean-db api_wallet --target api_wallet --yes
```

`clean-db` hace `TRUNCATE ... RESTART IDENTITY CASCADE` sobre las tablas del schema `public` y excluye `_prisma_migrations`.
- Si no usas `--yes`, pide confirmación escribiendo `DELETE`.

#### 4. Seed genérico (SQL)

```bash
vir postgres seed --db api_wallet --sql-file /ruta/seed.sql
vir postgres seed --db api_wallet --sql-dir /ruta/sql
vir postgres seed --db api_wallet --target api_wallet --sql-dir /ruta/sql
```

#### 5. Seed YAML (insert/upsert/update/delete, single o multi DB)

```bash
vir postgres seed-yaml --db api_wallet --seed resources/napa/databases/prisma/api-wallet/seed.yaml
vir postgres seed-yaml --seed resources/napa/databases/prisma/user-party.yaml
```

Formato básico (compatibilidad actual, una sola DB):

```yaml
tables:
  Currency:
    upsertBy: [id]
    rows:
      - id: USD
        name: US Dollar
        symbol: $
        decimalPrecision: 0.01
        type: fiat
  Party:
    upsertBy: [name]
    rows:
      - name: main
        type: organization
        chain: ""
  Account:
    upsertBy: [externalReference]
    rows:
      - externalReference: main-USD
        partyId:
          ref:
            table: Party
            where:
              name: main
            column: id
        name: main
        chain: ""
        currencyId: USD
        status: active
        availableBalance: 10000000
        depositBalance: 10000000
        payoutBalance: 0
        bonusBalance: 0
        pendingBalance: 0
        blockedBalance: 0
        updatedAt:
          sql: NOW()
```

Variables reutilizables:

```yaml
variables:
  ORG_ALIAS: main
  DEFAULT_STATUS: active

tables:
  Party:
    upsertBy: [name]
    rows:
      - name: "{{vars.ORG_ALIAS}}"
        type: organization
        chain: ""

operations:
  - type: update
    table: Account
    where:
      externalReference: "{{vars.ORG_ALIAS}}-USD"
    set:
      status: "{{vars.DEFAULT_STATUS}}"
      updatedAt:
        sql: NOW()
```

Formato multi base de datos en un solo archivo:

```yaml
variables:
  CHAIN: ROOT-ORG
  BASE_STATUS: active

databases:
  api_wallet:
    db: api_wallet
    target: api_wallet
    variables:
      MAIN_ALIAS: wallet-main
    tables:
      Party:
        upsertBy: [name]
        rows:
          - name: "{{vars.MAIN_ALIAS}}"
            type: organization
            chain: "{{vars.CHAIN}}"
    operations:
      - type: update
        table: Account
        where:
          externalReference: "{{vars.MAIN_ALIAS}}-USD"
        set:
          status: "{{vars.BASE_STATUS}}"
      - type: delete
        table: Account
        where:
          externalReference: "{{vars.MAIN_ALIAS}}-LEGACY"

  api_affiliations:
    db: api_affiliations
    target: api_affiliations
    operations:
      - type: insert
        table: Currency
        rows:
          - id: TEST
            name: Test Currency
            symbol: T
            decimalPrecision: 0.01
            type: fiat
            updatedAt:
              sql: NOW()
```

Notas:
- `tables` mantiene el comportamiento tradicional (`insert`/`upsert`).
- `operations` permite `insert`, `upsert`, `update` y `delete`.
- `{{vars.X}}` y `${X}` son válidos para interpolar variables.
- `databases.<key>.db` define el nombre real de la base.
- `databases.<key>.target` usa la configuración `databases.<target>` de `virt.config.yaml`.
- `databases.<key>.variables` permite sobrescribir o agregar variables por base.

---

### Comandos OpenSearch

```bash
vir opensearch <comando> [opciones]
```

#### 1. Cargar datos en OpenSearch (bulk)

```bash
vir opensearch load data.ndjson --endpoint http://localhost:9200
vir opensearch load data.json --index my-index
vir opensearch load data.yaml --index my-index --dry-run
vir opensearch load resources/napa/opensearch/api-wallet/seed-party.yaml --index party
vir opensearch load resources/napa/opensearch/api-wallet/seed-operation.yaml
```

- Para `.ndjson`/`.jsonl`, se envía el contenido tal cual al endpoint `/_bulk`.
- Para `.json`/`.yaml`, el CLI genera el bulk automáticamente (`--index` requerido solo si el documento no trae `_index`).
- Si el documento incluye `_index`, `_id` o `_routing`, esos metadatos se respetan (y `--index` pasa a ser fallback).
- Para `.yaml` también se soporta formato estructurado con `variables` + `documents`/`rows`.
- Para fechas dinámicas en YAML, podés usar `{{now}}` y offsets como `{{now-5m}}`, `{{now+2h}}`, `{{now+5ms}}`.
- `--dry-run` muestra el payload sin enviarlo.

#### 2. Crear un índice

```bash
vir opensearch create-index my-index
vir opensearch create-index my-index --body index-settings.json
vir opensearch create-index my-index --body index-settings.yaml
vir opensearch create-index party --body resources/napa/opensearch/api-wallet/party-index.yaml
vir opensearch create-index operations-2025-12 --body resources/napa/opensearch/api-wallet/operation-index.yaml
```

- `--body` acepta un archivo JSON o YAML con settings/mappings.

#### 2.1 Seed índice de operaciones

```bash
vir opensearch seed-operations
vir opensearch seed-operations --reset
vir opensearch seed-operations --dynamic-ids --dynamic-timestamps
```

#### 3. Insertar un documento

```bash
vir opensearch insert my-index doc.json
vir opensearch insert my-index doc.yaml --id my-doc-id
```

- El documento debe ser un objeto JSON/YAML (no array).

#### 4. Consultar estructura del índice

```bash
vir opensearch describe-index my-index
vir opensearch describe-index my-index --mappings
vir opensearch describe-index my-index --settings
vir opensearch describe-index my-index --mappings --unwrap
vir opensearch describe-index my-index --mappings --unwrap --format compact
vir opensearch describe-index my-index --mappings --table
```

- Por defecto devuelve mappings y settings.
- `--unwrap` devuelve solo el objeto de mappings/settings para reutilizarlo.
- `--format compact` imprime JSON en una sola línea (útil para piping).
- `--table` muestra los mappings en formato tabla (campo / tipo / keyword).

#### 5. Listar índices

```bash
vir opensearch list-indices
vir opensearch list-indices --format json
```

- Por defecto muestra una tabla.

#### 6. Consultar índice (search)

```bash
vir opensearch search party
vir opensearch search party --q "name:demo"
vir opensearch search party --q "type:person" --size 5 --from 10
vir opensearch search party --q "type:person" --table
vir opensearch search party --q "type:person" --table --fields id,name,chain
```

- Si no pasas `--q` o `--file`, ejecuta `match_all`.
- `--table` muestra hits en tabla; `--fields` elige columnas de `_source`.

#### 7. Eliminar documento

```bash
vir opensearch delete party 123
vir opensearch delete party 123 --yes
```

- Requiere confirmación interactiva escribiendo `DELETE` (usa `--yes` para omitirla).

#### 8. Eliminar todos los documentos

```bash
vir opensearch delete-all party
vir opensearch delete-all party --yes
```

- Ejecuta un `delete_by_query` con `match_all`.
- Requiere confirmación interactiva escribiendo `DELETE` (usa `--yes` para omitirla).

#### 8.1 Eliminar todos los documentos de todos los índices

```bash
vir opensearch delete-all-indices
vir opensearch delete-all-indices --yes
vir opensearch delete-all-indices --include-system --yes
```

- Ejecuta `delete_by_query` índice por índice.
- Por defecto excluye índices de sistema (`.` prefijo).

#### 9. Exportar definición de índice

```bash
vir opensearch export-index party --format yaml
vir opensearch export-index party --mappings --format json
vir opensearch export-index party --settings --format yaml --output resources/napa/opensearch/api-wallet/party-index.yaml
```

- Por defecto exporta mappings + settings.

### Desarrollo

- `npm run dev -- <comando>` ejecuta el CLI con `ts-node` (ideal para iterar sin compilar).
- `npm run lint` verifica estilo con ESLint.
- `npm run build` genera `dist/` listo para usar con el alias `vir` o publicar.

### Troubleshooting

- Si OpenSearch no responde, revisá `OPENSEARCH_URL` o pasá `--endpoint` manualmente.
- Después de cambiar código TypeScript, ejecutá `npm run build` antes de usar `vir …`.
- Para deshacer el enlace global: `npm unlink --global shell-virtual`.
