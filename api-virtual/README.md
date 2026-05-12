# api-virtual

Servidor liviano para montar múltiples APIs virtuales a partir de especificaciones OpenAPI y handlers declarativos escritos en YAML.

## Estructura

```
api-virtual/
  resources/
    config.yaml              # Conexiones simuladas a recursos externos
    apis/
      handlers.schema.json   # Schema para handlers declarativos
```

- `openapi.yaml`: define paths y schemas (se usa para derivar `basePath` desde `servers[0].url`).
- `handlers.yaml`: lista de rutas con `method`, `path` y `response` o `handler` (TS).
- `config.yaml`: recursos disponibles para los templates (`resources.postgres`, `resources.opensearch`, etc.).

Las APIs concretas viven en repositorios externos de stubs, por ejemplo
`virtualization-apis-stubs-napa` o `virtualization-apis-stubs-mep`, y se montan
con `VIRTUAL_RESOURCES_DIRS`.

### Workflows declarativos (sin código específico por endpoint)

Además de `response` o `handler`, una ruta puede definir `workflow` con pasos declarativos.
El workflow se ejecuta contra recursos (por ejemplo OpenSearch) y devuelve una respuesta
armada con `response.bodyTemplate`.

#### Orden de resolución por ruta

`api-virtual` resuelve una ruta en este orden:
1. `workflow` (si existe)
2. `handler` (si existe y no hay `workflow`)
3. `response` / `response.bodyTemplate`

Esto permite empezar declarativo y usar `handler` TS solo cuando falta una capacidad global.

#### Estructura base de workflow

```yaml
routes:
  - method: GET
    path: /health
    workflow:
      steps:
        - set: now
          valueTemplate: "{{meta.now}}"
      response:
        status: 200
        bodyTemplate:
          ok: true
          now: "{{vars.now}}"
```

#### Contexto disponible en templates

Podés interpolar con `{{...}}` contra:
- `params.*`
- `query.*`
- `body.*`
- `resources.*` (desde `resources/config.yaml`)
- `meta.now`, `meta.randomId`, `meta.requestId`
- `vars.*` (estado acumulado del workflow)
- `item` / `index` (dentro de `forEach`) o alias `as` / `indexAs`

Notas:
- Si el template es exactamente `{{token}}`, conserva el tipo original (number/boolean/object/array).
- Si `{{token}}` está embebido dentro de un string, el resultado final es string.

#### Tipos de paso soportados

1. `set`: escribe valor en `vars`.

```yaml
- set: page
  valueTemplate: "{{query.page}}"
```

2. `append`: agrega un elemento al array en `vars` (crea array si no existe).

```yaml
- append: rows
  valueTemplate:
    id: "{{item.id}}"
```

3. `forEach`: itera una colección y ejecuta `steps` anidados.

```yaml
- forEach: "{{vars.items}}"
  as: row
  indexAs: i
  steps:
    - append: ids
      valueTemplate: "{{row.id}}"
```

4. `action`: ejecuta una acción global reutilizable.

```yaml
- action: util.toInt
  input:
    value: "{{query.limit}}"
    default: 20
  saveAs: limit
```

5. `when` (opcional): guard para ejecutar condicionalmente cualquier paso.

```yaml
- when: "{{query.affiliateId}}"
  set: hasAffiliate
  value: true
```

#### Acciones `util.*` (genéricas)

| Acción | Propósito | Input principal | Output típico |
|---|---|---|---|
| `util.makeId` | Generar id estable + random suffix | `prefix`, `parts[]` | `string` |
| `util.toInt` | Parse/clamp entero | `value`, `default`, `min`, `max` | `number` |
| `util.math` | Operación numérica | `op: add/sub/mul/div/min/max`, `a`, `b` | `number` |
| `util.coalesce` | Primer valor no vacío | `values[]`, `default` | `unknown` |
| `util.boolToInt` | `true/false` a `1/0` | `value` | `number` |
| `util.require` | Validación y corte de flujo | `condition`, `status`, `message` | `{ ok: true }` o error HTTP |
| `util.extractSearch` | Normaliza respuesta `_search` | `searchResult` | `{ total, hits, sources }` |
| `util.buildFilters` | Construye filtros OpenSearch | `items[]` (`term` / `range`) | `array` |
| `util.toBoolQuery` | Convierte filtros a query | `filters[]` | `query object` |
| `util.select` | Selección por clave | `key`, `options`, `default` | `unknown` |
| `util.generateNetwinSimulation` | Dataset demo de netwin + bets | `playerId`, `affiliateId`, `currency`, `now`, `days`, `betsPerDay` | `{ dailyDocs, betDocs }` |

#### Acciones `opensearch.*` (genéricas)

Todas usan por defecto `resource: opensearch`.
El endpoint se toma de `resources.<resource>.endpoint`.

| Acción | Propósito | Input principal | Output típico |
|---|---|---|---|
| `opensearch.search` | Ejecutar `_search` | `index`, `body` | respuesta OpenSearch (`hits`, `aggregations`) |
| `opensearch.count` | Ejecutar `_count` | `index`, `query` | `{ count }` |
| `opensearch.get` | Obtener documento por id | `index`, `id` | `{ found, source, raw }` |
| `opensearch.index` | Upsert documento por id | `index`, `id`, `document` | respuesta `_doc` |
| `opensearch.bulk` | Indexación masiva | `index`, `documents[]` | respuesta `_bulk` |
| `opensearch.delete` | Borrado por id | `index`, `id` | `{ deleted, result }` |
| `opensearch.deleteByQuery` | Borrado masivo por query | `index`, `query` | `{ deleted }` |

Comportamiento de creación de índices:
- `opensearch.index` y `opensearch.bulk` hacen `ensure index` automático.
- Si definís `resources.opensearch.indexDefinitions`, usa ese mapping/settings al crear.
- Si no hay definición, crea índice vacío.

Formato de `documents[]` en `opensearch.bulk`:
- Variante 1: `{ id: "...", document: { ... } }`
- Variante 2: `{ id: "...", campoA: "...", campoB: 1 }` (usa el resto de campos como body)

#### Ejemplo práctico (alta + simulación)

```yaml
- action: util.makeId
  input:
    prefix: plr
    parts: ["{{body.affiliateId}}", "{{body.externalReference}}"]
  saveAs: playerId

- set: player
  valueTemplate:
    id: "{{vars.playerId}}"
    affiliateId: "{{body.affiliateId}}"
    fullName: "{{body.fullName}}"
    createdAt: "{{meta.now}}"

- action: opensearch.index
  input:
    index: "{{resources.opensearch.indices.players}}"
    id: "{{vars.playerId}}"
    document: "{{vars.player}}"

- action: util.generateNetwinSimulation
  input:
    playerId: "{{vars.playerId}}"
    affiliateId: "{{body.affiliateId}}"
    currency: DOP
    now: "{{meta.now}}"
    days: 14
    betsPerDay: 3
  saveAs: simulation

- action: opensearch.bulk
  input:
    index: "{{resources.opensearch.indices.playerNetwinDaily}}"
    documents: "{{vars.simulation.dailyDocs}}"
```

### Handlers en múltiples archivos

Podés dividir los handlers en varios archivos dentro de `handlers/` (por ejemplo uno por endpoint o dominio).

Reglas:
- `handlers.yaml` es el principal y se usa para `api` (name/basePath/description).
- Los archivos `handlers/*.yaml` se cargan en orden alfabético y sus `routes` se concatenan.
- Si un archivo en `handlers/` trae `api`, se ignora y se muestra un warning.

Ejemplo:

```
resources/apis/api-data/
  openapi.yaml
  handlers.yaml
  handlers/
    reports.netwin.yaml
    reports.public-funds.yaml
    loyalty.segmentation.yaml
```

### Handlers TS locales (lógica real)

Para endpoints con lógica real, podés apuntar a un handler en TypeScript dentro de `api-virtual`.
El controller sigue en `api-virtual` y solo delega la lógica a una función.

En un handler:

```yaml
routes:
  - method: GET
    path: /reports/netwin
    handler: api-data/netwin
```

También podés usar una export nombrada con formato `archivo.export`, por ejemplo:

```yaml
routes:
  - method: GET
    path: /reports/summary
    handler: tools/reports.buildSummary
```

El módulo debe vivir en `api-virtual/src/handlers/api-data/netwin.ts` y exportar una función:

```ts
import type { HandlerContext, HandlerResult } from "../types";

export default function handler(ctx: HandlerContext): HandlerResult {
  return { status: 200, body: { ok: true } };
}
```

Notas:
- Si `handler` está presente, se ignora `response`.
- En `npm run build`, los handlers se compilan a `dist/handlers/...` automáticamente.

### Schema YAML (VS Code)

Si VS Code muestra errores del tipo “Ansible Tasks Schema”, es porque el workspace asocia YAMLs con ese schema.

Este repo incluye un schema propio en `api-virtual/resources/apis/handlers.schema.json`.
La forma más portable (sin depender de `.vscode`, que está ignorado en `.gitignore`) es usar
la directiva inline al inicio de cada archivo:

En `handlers.yaml`:

```yaml
# yaml-language-server: $schema=../handlers.schema.json
```

En `handlers/*.yaml`:

```yaml
# yaml-language-server: $schema=../../handlers.schema.json
```

Si preferís usar `.vscode/settings.json`, eliminá `.vscode/` de `.gitignore` y definí `yaml.schemas`
para asociar esos archivos al schema.

## Ejecución

```bash
npm install
npm run dev
```

Por defecto levanta en el puerto `4000` o `PORT` si está definido.

### Swagger UI

- Ruta: `/virtual/swagger` (redirige a `/virtual/apis/ui`)
- Toggle: `SWAGGER_ENABLED` (`true` por defecto). Si es `false`, la UI no se monta.

Las specs que se cargan son las mismas del directorio `resources/apis/*/openapi.yaml`.

### Rutas de utilidad

- `/virtual/apis` lista las APIs cargadas.
- `/virtual/apis/ui` muestra un listado visual con links a Docs y OpenAPI.
- `/virtual/swagger` y `/virtual/swagger/ui` redirigen a `/virtual/apis/ui`.
- `<basePath>/__meta/openapi` devuelve el YAML original.
- `<basePath>/__meta/info` devuelve metadatos básicos.

### Respuestas templadas

`bodyTemplate` permite interpolar:

- `{{params.*}}`, `{{query.*}}`, `{{body.*}}`
- `{{resources.*}}` valores de `config.yaml`
- `{{meta.now}}` (ISO string), `{{meta.randomId}}`, `{{meta.requestId}}`

### Medición de tiempos

`api-virtual` puede medir el tiempo de respuesta por request y exponerlo en un header.

Variables:
- `TIMING_ENABLED` (`true` por defecto): agrega el header con el tiempo.
- `TIMING_HEADER` (`x-virtual-response-time-ms` por defecto): nombre del header.
- `TIMING_LOG` (`false` por defecto): logea cada request con su tiempo.

Ejemplo:

```bash
TIMING_ENABLED=true TIMING_LOG=true npm run dev
```

### Hot reload de recursos

`api-virtual` puede recargar automáticamente los recursos (`openapi.yaml`, `handlers*.yaml`, `config.yaml`)
sin reiniciar el servicio.

Variables:
- `HOT_RELOAD_ENABLED` (`true` por defecto): activa la recarga automática.
- `HOT_RELOAD_INTERVAL_MS` (`2000` por defecto): intervalo de detección en ms.

También podés forzar un reload manual:

```bash
curl -X POST http://localhost:4000/virtual/reload
```

### Filtrar APIs por contenedor

Si querés desplegar solo algunas APIs por contenedor (recomendado para prod), podés usar:

- `VIRTUAL_RESOURCES_DIRS`: lista separada por coma de directorios `resources` a cargar. Si no se define, usa `api-virtual/resources`. También se mantiene `VIRTUAL_RESOURCES_DIR` para un único directorio.
- `VIRTUAL_APIS` (allowlist): lista separada por coma.
- `VIRTUAL_APIS_EXCLUDE` (denylist): lista separada por coma.

Ejemplo:

```bash
VIRTUAL_RESOURCES_DIRS=./resources,/external-stubs/resources VIRTUAL_APIS=api-data,api-wallet,mep-bcra npm run dev
```

Esto permite usar la misma imagen y definir qué APIs carga cada contenedor.
