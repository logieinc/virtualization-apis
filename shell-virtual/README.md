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

# Registrar el binario localmente. Esto expone dos comandos: `shell-virtual` y el alias corto `virt`.
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
virt <comando> [opciones]
```

### Comandos MongoDB

```bash
virt mongo <comando> [opciones]
```

#### 1. Listar colecciones

```bash
virt mongo list-collections
```

#### 2. Insertar documentos

```bash
virt mongo insert party resources/model/party/data.yaml
```

#### 3. Buscar documentos

```bash
virt mongo find party
virt mongo find party --filter resources/model/party/filter.yaml --limit 5
virt mongo find party --filter resources/model/party/filter.yaml --table --fields id,name,type
```

#### 4. Eliminar documentos

```bash
virt mongo delete party 64e9c9e4f9c2c6a1b2c3d4e5
virt mongo delete party --filter resources/model/party/filter.yaml
virt mongo delete party --filter resources/model/party/filter.yaml --yes
```

#### 5. Exportar documentos

```bash
virt mongo export party --format json
virt mongo export party --format yaml --output resources/model/party/data.yaml
```

---

### Comandos Postgres

```bash
virt postgres <comando> [opciones]
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
virt postgres create-db api_wallet --schema-dir resources/napa/seeds/postgres/sql
virt postgres create-db api_wallet --drop --yes --schema-file /ruta/schema.sql
virt postgres create-db api_wallet --schema-file resources/napa/databases/prisma/api-wallet/schema.prisma
virt postgres create-db api_wallet --target api_wallet --schema-dir resources/napa/seeds/postgres/sql
```

#### 2. Dropear una base individual

```bash
virt postgres drop-db api_wallet --yes
virt postgres drop-db api_wallet --target api_wallet --yes
```

#### 3. Seed genérico (SQL)

```bash
virt postgres seed --db api_wallet --sql-file /ruta/seed.sql
virt postgres seed --db api_wallet --sql-dir /ruta/sql
virt postgres seed --db api_wallet --target api_wallet --sql-dir /ruta/sql
```

#### 4. Seed YAML (insert/upsert/update/delete, single o multi DB)

```bash
virt postgres seed-yaml --db api_wallet --seed resources/napa/databases/prisma/api-wallet/seed.yaml
virt postgres seed-yaml --seed resources/napa/databases/prisma/multi-db.seed.example.yaml
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
virt opensearch <comando> [opciones]
```

#### 1. Cargar datos en OpenSearch (bulk)

```bash
virt opensearch load data.ndjson --endpoint http://localhost:9200
virt opensearch load data.json --index my-index
virt opensearch load data.yaml --index my-index --dry-run
```

- Para `.ndjson`/`.jsonl`, se envía el contenido tal cual al endpoint `/_bulk`.
- Para `.json`/`.yaml`, se requiere `--index` y el CLI genera el bulk automáticamente.
- `--dry-run` muestra el payload sin enviarlo.

#### 2. Crear un índice

```bash
virt opensearch create-index my-index
virt opensearch create-index my-index --body index-settings.json
virt opensearch create-index my-index --body index-settings.yaml
```

- `--body` acepta un archivo JSON o YAML con settings/mappings.

#### 2.1 Seed índice de operaciones

```bash
virt opensearch seed-operations
virt opensearch seed-operations --reset
virt opensearch seed-operations --dynamic-ids --dynamic-timestamps
```

#### 3. Insertar un documento

```bash
virt opensearch insert my-index doc.json
virt opensearch insert my-index doc.yaml --id my-doc-id
```

- El documento debe ser un objeto JSON/YAML (no array).

#### 4. Consultar estructura del índice

```bash
virt opensearch describe-index my-index
virt opensearch describe-index my-index --mappings
virt opensearch describe-index my-index --settings
virt opensearch describe-index my-index --mappings --unwrap
virt opensearch describe-index my-index --mappings --unwrap --format compact
virt opensearch describe-index my-index --mappings --table
```

- Por defecto devuelve mappings y settings.
- `--unwrap` devuelve solo el objeto de mappings/settings para reutilizarlo.
- `--format compact` imprime JSON en una sola línea (útil para piping).
- `--table` muestra los mappings en formato tabla (campo / tipo / keyword).

#### 5. Listar índices

```bash
virt opensearch list-indices
virt opensearch list-indices --format json
```

- Por defecto muestra una tabla.

#### 6. Consultar índice (search)

```bash
virt opensearch search party
virt opensearch search party --q "name:demo"
virt opensearch search party --file resources/model/party/search.yaml
virt opensearch search party --q "type:person" --size 5 --from 10
virt opensearch search party --q "type:person" --table
virt opensearch search party --q "type:person" --table --fields id,name,chain
```

- Si no pasas `--q` o `--file`, ejecuta `match_all`.
- `--table` muestra hits en tabla; `--fields` elige columnas de `_source`.

#### 7. Eliminar documento

```bash
virt opensearch delete party 123
virt opensearch delete party 123 --yes
```

- Requiere confirmación interactiva (usa `--yes` para omitirla).

#### 8. Eliminar todos los documentos

```bash
virt opensearch delete-all party
virt opensearch delete-all party --yes
```

- Ejecuta un `delete_by_query` con `match_all`.
- Requiere confirmación interactiva (usa `--yes` para omitirla).

#### 9. Exportar definición de índice

```bash
virt opensearch export-index party --format yaml
virt opensearch export-index party --mappings --format json
virt opensearch export-index party --settings --format yaml --output resources/model/party/index.yaml
```

- Por defecto exporta mappings + settings.

### Desarrollo

- `npm run dev -- <comando>` ejecuta el CLI con `ts-node` (ideal para iterar sin compilar).
- `npm run lint` verifica estilo con ESLint.
- `npm run build` genera `dist/` listo para usar con el alias `virt` o publicar.

### Troubleshooting

- Si OpenSearch no responde, revisá `OPENSEARCH_URL` o pasá `--endpoint` manualmente.
- Después de cambiar código TypeScript, ejecutá `npm run build` antes de usar `virt …`.
- Para deshacer el enlace global: `npm unlink --global shell-virtual`.
