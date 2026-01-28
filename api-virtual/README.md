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
- `handlers.yaml`: lista de rutas con `method`, `path` y `response` (status, headers, body o bodyTemplate).
- `config.yaml`: recursos disponibles para los templates (`resources.postgres`, `resources.opensearch`, etc.).

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
