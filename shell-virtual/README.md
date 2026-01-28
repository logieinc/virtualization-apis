## Shell Virtual CLI

Herramienta en Node.js/TypeScript para cargar datos en OpenSearch desde la línea de comandos.

> Este módulo se creó copiando la estructura de `shell-affiliations`. Ajustá los comandos y endpoints según el contexto de virtualización.

### Requisitos

- Node.js 20 o superior.
- OpenSearch corriendo y accesible (por defecto en `http://localhost:9200`).

### Instalación y enlace rápido

```bash
# Instalar dependencias
npm install

# Compilar los archivos TypeScript a dist/
npm run build

# Registrar el binario localmente. Esto expone dos comandos: `shell-virtual` y el alias corto `virt`.
npm link
```

Puedes copiar `.env.example` a `.env` para configurar la URL y credenciales de OpenSearch:

```bash
cp .env.example .env
# (opcional) editar .env para apuntar a otro endpoint o setear usuario/password
```

> El CLI busca primero un `.env` en el directorio desde donde lo ejecutás; si no existe, usa `shell-virtual/.env`.
> También podés ejecutar el CLI sin compilar usando `npm run dev -- <comando>` mientras desarrollás.

### Variables de entorno

- `OPENSEARCH_URL` (por defecto `http://localhost:9200`)
- `OPENSEARCH_USER` (opcional)
- `OPENSEARCH_PASSWORD` (opcional)
- `MONGO_URL` (por defecto `mongodb://localhost:27017`)
- `MONGO_DB` (por defecto `virtual`)

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
