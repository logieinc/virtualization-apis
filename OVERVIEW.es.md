# virtualization-apis - Overview

`virtualization-apis` es un workspace para simular APIs, datos y servicios de
soporte durante desarrollo, pruebas funcionales e integraciones locales.

El objetivo es tener un entorno reproducible donde una aplicacion pueda
conectarse contra APIs virtuales sin depender de sistemas externos reales.

## Alcance

El workspace cubre tres necesidades:

- Exponer endpoints HTTP virtuales a partir de especificaciones OpenAPI y
  handlers declarativos.
- Ejecutar workflows simples contra recursos locales como OpenSearch, MongoDB
  o Postgres.
- Operar datos de soporte desde un CLI para cargar, consultar, exportar o
  limpiar informacion de prueba.

No contiene reglas de negocio de un cliente particular. Las APIs concretas,
datasets y respuestas especificas se montan desde directorios de recursos
externos o repositorios de stubs.

## Modulos

### api-virtual

Servidor HTTP que carga una o mas APIs virtuales desde recursos declarativos.

Entradas principales:

- `openapi.yaml`: contrato HTTP de la API.
- `handlers.yaml`: rutas, respuestas, workflows o handlers TypeScript.
- `resources/config.yaml`: conexiones y nombres logicos de recursos.
- `handlers/*.yaml`: archivos opcionales para separar rutas por dominio.

Capacidades principales:

- Listado de APIs cargadas.
- UI de catalogo y documentacion OpenAPI.
- Respuestas estaticas o templadas.
- Workflows declarativos con variables, condiciones, loops y acciones.
- Acciones reutilizables para utilidades y recursos locales.
- Estado virtual document-oriented respaldado por MongoDB para escenarios que
  necesitan persistir casos de prueba entre requests.
- Filtro de APIs por variables de entorno para correr solo un subconjunto.

### shell-virtual

CLI para operar datos de prueba y recursos locales.

Capacidades principales:

- OpenSearch: crear indices, cargar documentos, buscar, exportar y limpiar.
- MongoDB: listar colecciones, insertar, buscar, exportar y borrar documentos.
- Postgres: crear bases, cargar SQL/YAML, truncar datos y ejecutar seeds.

El CLI puede trabajar contra recursos levantados por Docker Compose o contra
hosts configurados por ambiente.

## Flujo de uso

1. Levantar los servicios base del workspace.
2. Montar uno o mas directorios de recursos con APIs virtuales.
3. Ejecutar `api-virtual` para exponer los endpoints.
4. Usar `shell-virtual` para preparar o inspeccionar datos.
5. Apuntar la aplicacion bajo prueba a las URLs virtuales.

Ejemplo local:

```bash
docker compose up api-virtual opensearch mongo postgres
```

URLs habituales:

- API virtual: `http://localhost:4000`
- Catalogo: `http://localhost:4000/virtual/apis`
- UI: `http://localhost:4000/virtual/apis/ui`

## Recursos externos

Las APIs virtuales no tienen que vivir dentro de este repo. Se pueden montar
recursos externos con variables de entorno:

```bash
VIRTUAL_RESOURCES_DIRS=./resources,/path/to/stubs/resources npm run dev
```

Tambien se puede limitar que APIs carga el contenedor:

```bash
VIRTUAL_APIS=api-one,api-two npm run dev
VIRTUAL_APIS_EXCLUDE=api-legacy npm run dev
```

## Workflows declarativos

Una ruta puede resolver su respuesta de tres formas:

1. `workflow`: pasos declarativos contra variables y recursos.
2. `handler`: funcion TypeScript cuando hace falta logica especifica.
3. `response` o `response.bodyTemplate`: respuesta estatica o templada.

Ejemplo simple:

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

El contexto de template incluye:

- `params.*`
- `query.*`
- `body.*`
- `resources.*`
- `meta.now`
- `meta.randomId`
- `meta.requestId`
- `vars.*`

Las acciones disponibles son genericas por familia:

- `util.*`: transformaciones, validaciones, ids, seleccion y operaciones
  numericas.
- `opensearch.*`: busqueda, conteo, lectura, escritura, bulk y borrado.
- `virtual.state.*`: carga, consulta y actualizacion de casos virtuales en
  almacenamiento document-oriented.

## Operacion de datos

`shell-virtual` permite preparar datos sin escribir scripts por cada caso.

Ejemplos:

```bash
vir opensearch list-indices
vir opensearch load data.yaml --index sample-index
vir mongo find sample_collection --limit 10
vir postgres seed-yaml --db sample_db --seed seed.yaml
```

Los comandos destructivos piden confirmacion por defecto y aceptan `--yes` para
automatizacion controlada.

## Configuracion por ambiente

El CLI busca configuracion en archivos como:

- `virt.config.yaml`
- `virt.config.yml`
- `.virt.yaml`
- `.virt.yml`

Un ambiente puede declarar endpoints, paths, recursos de datos y modo de
conexion. La misma estructura sirve para local, CI o integraciones remotas.

## Principios

- Mantener este repo generico.
- Poner datos, contratos concretos y mocks especificos en stubs externos.
- Preferir YAML declarativo para casos simples.
- Usar handlers TypeScript solo cuando el workflow declarativo no alcanza.
- Evitar credenciales reales dentro del repositorio.
- No versionar archivos `.env` locales.
