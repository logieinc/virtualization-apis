# api-virtual

Servidor liviano para montar múltiples APIs virtuales a partir de especificaciones OpenAPI y handlers declarativos escritos en YAML.

## Estructura

```
api-virtual/
  resources/
    config.yaml              # Conexiones simuladas a recursos externos
    apis/
      wallet/
        openapi.yaml         # Especificación OAS
        handlers.yaml        # Respuestas mock configurables
      payments/
        openapi.yaml
        handlers.yaml
```

- `openapi.yaml`: define paths y schemas (se usa para derivar `basePath` desde `servers[0].url`).
- `handlers.yaml`: lista de rutas con `method`, `path` y `response` o `handler` (TS).
- `config.yaml`: recursos disponibles para los templates (`resources.postgres`, `resources.opensearch`, etc.).

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

- `VIRTUAL_APIS` (allowlist): lista separada por coma.
- `VIRTUAL_APIS_EXCLUDE` (denylist): lista separada por coma.

Ejemplo:

```bash
VIRTUAL_APIS=api-data,api-wallet npm run dev
```

Esto permite usar la misma imagen y definir qué APIs carga cada contenedor.
