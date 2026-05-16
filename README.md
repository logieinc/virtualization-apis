# virtualization-apis

Repositorio para levantar APIs virtuales y operar datos de soporte en entornos
locales o de integracion.

La documentacion canonica del workspace esta en
[OVERVIEW.es.md](OVERVIEW.es.md).

## Ejecucion rapida

```bash
docker compose up api-virtual opensearch mongo postgres
```

Puntos de entrada:

- API virtual: `http://localhost:4000`
- Catalogo visual: `http://localhost:4000/virtual/apis/ui`
- Overview: [OVERVIEW.es.md](OVERVIEW.es.md)
