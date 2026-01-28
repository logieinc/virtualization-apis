import express, { Request, Response, Router } from 'express';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { parse as parseYaml } from 'yaml';
import swaggerUi from 'swagger-ui-express';

interface HandlerResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  bodyTemplate?: unknown;
  delayMs?: number;
}

interface HandlerDefinition {
  operationId?: string;
  summary?: string;
  method: string;
  path: string;
  response?: HandlerResponse;
}

interface ApiMetadata {
  name?: string;
  basePath?: string;
  description?: string;
}

interface HandlersFile {
  api?: ApiMetadata;
  routes: HandlerDefinition[];
}

interface VirtualApi {
  id: string;
  name: string;
  description?: string;
  basePath: string;
  openApiPath: string;
  openApi: any;
  handlers: HandlerDefinition[];
}

interface ResourcesConfig {
  resources?: Record<string, unknown>;
}

const DEFAULT_PORT = Number(process.env.PORT ?? 4000);
const SWAGGER_ENABLED = (process.env.SWAGGER_ENABLED ?? 'true').toLowerCase() !== 'false';
const resourcesRoot = process.env.VIRTUAL_RESOURCES_DIR
  ? path.resolve(process.env.VIRTUAL_RESOURCES_DIR)
  : path.resolve(__dirname, '..', 'resources');
const assetsRoot = path.resolve(__dirname, '..', 'public', 'assets');
const swaggerCss = `
  .swagger-ui .topbar { background: #0f172a; }
  .swagger-ui .topbar .wrapper .link,
  .swagger-ui .topbar .wrapper .link:visited,
  .swagger-ui .topbar .topbar-wrapper .link,
  .swagger-ui .topbar .topbar-wrapper .link:visited,
  .swagger-ui .topbar .topbar-wrapper a {
    display: block !important;
    width: 180px !important;
    height: 42px !important;
    background: url('/assets/logo.svg') center / contain no-repeat !important;
    text-indent: -9999px !important;
    overflow: hidden !important;
  }
  .swagger-ui .topbar .wrapper .link img,
  .swagger-ui .topbar .wrapper .link svg,
  .swagger-ui .topbar .wrapper .link span,
  .swagger-ui .topbar .topbar-wrapper .link img,
  .swagger-ui .topbar .topbar-wrapper .link svg,
  .swagger-ui .topbar .topbar-wrapper .link span {
    display: none !important;
  }
  .swagger-ui .topbar .wrapper,
  .swagger-ui .topbar .topbar-wrapper {
    display: flex;
    align-items: center;
    width: 100%;
  }
  .swagger-ui .topbar .topbar-wrapper::after {
    content: "fabian@logieinc.com";
    display: inline-flex;
    align-items: center;
    margin-left: auto;
    margin-right: 12px;
    padding: 4px 10px;
    border-radius: 999px;
    background: #0b1220;
    color: #e2e8f0;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
`;

const app = express();
app.use(express.json());
app.use(morgan('dev'));
if (fs.existsSync(assetsRoot)) {
  app.use('/assets', express.static(assetsRoot));
}

const sharedResources = loadResourcesConfig(resourcesRoot);
const apis = loadVirtualApis(resourcesRoot);

apis.forEach(api => {
  const router = buildApiRouter(api, sharedResources);
  app.use(api.basePath, router);
});

if (SWAGGER_ENABLED && apis.length > 0) {
  const urls = apis.map(api => ({
    url: `${api.basePath}/__meta/openapi`,
    name: api.name
  }));
  app.get('/virtual/swagger', (_req, res) => {
    res.redirect('/virtual/apis/ui');
  });
  app.get('/virtual/swagger/ui', (_req, res) => {
    res.redirect('/virtual/apis/ui');
  });
  app.use(
    '/virtual/swagger/ui',
    swaggerUi.serve,
    swaggerUi.setup(null, {
      swaggerOptions: { urls },
      customSiteTitle: 'api-virtual swagger',
      customfavIcon: '/assets/logo.svg',
      customCss: swaggerCss
    })
  );
}

app.get('/virtual/apis', (_req, res) => {
  const payload = apis.map(api => ({
    id: api.id,
    name: api.name,
    description: api.description ?? api.openApi?.info?.description,
    basePath: api.basePath,
    operations: api.handlers.length
  }));
  res.json({
    apis: payload,
    resources: Object.keys(sharedResources.resources ?? {}),
    swaggerEnabled: SWAGGER_ENABLED
  });
});

app.get('/virtual/apis/ui', (_req, res) => {
  const items = apis
    .map(api => {
      const description = api.description ?? api.openApi?.info?.description ?? '';
      const docsUrl = `${api.basePath}/docs`;
      const openApiUrl = `${api.basePath}/__meta/openapi`;
      return `
        <article class="card">
          <h2>${escapeHtml(api.name ?? api.id)}</h2>
          <p>${escapeHtml(description)}</p>
          <div class="meta">
            <span class="pill">${escapeHtml(api.id)}</span>
            <span class="pill">${escapeHtml(api.basePath)}</span>
            <span class="pill">${api.handlers.length} ops</span>
          </div>
          <div class="links">
            <a href="${escapeHtml(docsUrl)}">Docs</a>
            <a href="${escapeHtml(openApiUrl)}">OpenAPI</a>
          </div>
        </article>
      `;
    })
    .join('');

  const resources = Object.keys(sharedResources.resources ?? {})
    .map(resource => `<span class="pill">${escapeHtml(resource)}</span>`)
    .join('');

  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.send(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Virtual APIs</title>
        <style>
          :root { color-scheme: light dark; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
            background: #0f172a;
            color: #e2e8f0;
          }
          header {
            padding: 24px 32px;
            background: #111827;
            border-bottom: 1px solid #1f2937;
          }
          h1 { margin: 0 0 8px; font-size: 22px; }
          .sub { color: #94a3b8; font-size: 14px; }
          main { padding: 24px 32px 40px; }
          .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
            gap: 16px;
          }
          .card {
            background: #111827;
            border: 1px solid #1f2937;
            border-radius: 14px;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            min-height: 160px;
          }
          .card h2 { margin: 0; font-size: 18px; }
          .card p { margin: 0; color: #94a3b8; font-size: 14px; }
          .meta { display: flex; flex-wrap: wrap; gap: 6px; }
          .pill {
            display: inline-flex;
            align-items: center;
            padding: 4px 8px;
            border-radius: 999px;
            font-size: 12px;
            background: #0b1220;
            color: #cbd5f5;
            border: 1px solid #1e293b;
          }
          .links { display: flex; gap: 10px; margin-top: auto; }
          .links a {
            color: #38bdf8;
            text-decoration: none;
            font-weight: 600;
            font-size: 13px;
          }
          .links a:hover { text-decoration: underline; }
          .resources { margin-top: 16px; display: flex; flex-wrap: wrap; gap: 6px; }
        </style>
      </head>
      <body>
        <header>
          <h1>Virtual APIs</h1>
          <div class="sub">Swagger enabled: ${SWAGGER_ENABLED ? 'yes' : 'no'}</div>
          <div class="resources">${resources}</div>
        </header>
        <main>
          <section class="grid">${items}</section>
        </main>
      </body>
    </html>
  `);
});

app.use((_req, res) => {
  res.status(404).json({ message: 'Not found in api-virtual' });
});

app.listen(DEFAULT_PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[api-virtual] Serving ${apis.length} API(s) from ${resourcesRoot} on port ${DEFAULT_PORT}`
  );
});

function buildApiRouter(api: VirtualApi, sharedConfig: ResourcesConfig): Router {
  const router = Router();

  router.get('/__meta/openapi', (_req, res) => {
    res.setHeader('content-type', 'application/yaml');
    res.send(fs.readFileSync(api.openApiPath, 'utf8'));
  });

  router.get('/__meta/info', (_req, res) => {
    res.json({
      id: api.id,
      name: api.name,
      description: api.description ?? api.openApi?.info?.description,
      basePath: api.basePath,
      operations: api.handlers.length
    });
  });

  if (SWAGGER_ENABLED) {
    const swaggerAssets = swaggerUi.serveFiles(api.openApi);
    router.use(
      '/docs',
      swaggerAssets,
      swaggerUi.setup(api.openApi, {
        customSiteTitle: `${api.name} docs`,
        customfavIcon: '/assets/logo.svg',
        customCss: swaggerCss
      })
    );
  }

  api.handlers.forEach(handler => {
    const method = handler.method.toLowerCase();
    const expressPath = toExpressPath(handler.path);
    const response = handler.response ?? {};

    (router as any)[method](expressPath, async (req: Request, res: Response) => {
      if (response.delayMs && response.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, response.delayMs));
      }

      const status = response.status ?? 200;
      const headers = response.headers ?? {};
      Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));

      const context = {
        params: req.params,
        query: req.query,
        body: req.body,
        resources: sharedConfig.resources ?? {},
        meta: {
          now: new Date().toISOString(),
          randomId: createRandomId(),
          requestId:
            (req.headers['x-request-id'] as string | undefined) ?? createRandomId()
        }
      };

      const payload =
        response.bodyTemplate !== undefined
          ? applyTemplate(response.bodyTemplate, context)
          : response.body ?? { ok: true };

      res.status(status).json(payload);
    });
  });

  return router;
}

function escapeHtml(input: string) {
  return input.replace(/[&<>"']/g, char => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function loadResourcesConfig(root: string): ResourcesConfig {
  const configPath = path.join(root, 'config.yaml');
  if (!fs.existsSync(configPath)) {
    return {};
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  return parseYaml(raw) as ResourcesConfig;
}

function loadVirtualApis(root: string): VirtualApi[] {
  const apisDir = path.join(root, 'apis');
  if (!fs.existsSync(apisDir)) {
    return [];
  }

  const entries = fs.readdirSync(apisDir, { withFileTypes: true }).filter(dirent =>
    dirent.isDirectory()
  );

  return entries.map(entry => {
    const apiId = entry.name;
    const apiDir = path.join(apisDir, apiId);
    const openApiPath = resolveFirstExisting(apiDir, ['openapi.yaml', 'openapi.yml']);
    if (!openApiPath) {
      throw new Error(`Missing openapi.yaml in ${apiDir}`);
    }

    const handlersPath = resolveFirstExisting(apiDir, ['handlers.yaml', 'handlers.yml']);
    if (!handlersPath) {
      throw new Error(`Missing handlers.yaml in ${apiDir}`);
    }

    const openApi = parseYaml(fs.readFileSync(openApiPath, 'utf8'));
    const handlersFile = parseYaml(fs.readFileSync(handlersPath, 'utf8')) as HandlersFile;
    const basePath = resolveBasePath(apiId, handlersFile.api?.basePath, openApi);
    const name =
      handlersFile.api?.name ??
      openApi?.info?.title ??
      `Virtual API ${apiId}`;

    const handlers = normalizeHandlers(handlersFile.routes ?? []);

    return {
      id: apiId,
      name,
      description: handlersFile.api?.description ?? openApi?.info?.description,
      basePath,
      openApiPath,
      openApi,
      handlers
    };
  });
}

function resolveBasePath(apiId: string, explicitBasePath?: string, openApi?: any): string {
  if (explicitBasePath) {
    return explicitBasePath;
  }
  const serverUrl = openApi?.servers?.[0]?.url;
  if (serverUrl) {
    return serverUrl;
  }
  return `/${apiId}`;
}

function normalizeHandlers(routes: HandlerDefinition[]): HandlerDefinition[] {
  return routes.map(route => ({
    ...route,
    method: route.method.toLowerCase(),
    path: route.path
  }));
}

function resolveFirstExisting(dir: string, candidates: string[]): string | null {
  for (const candidate of candidates) {
    const full = path.join(dir, candidate);
    if (fs.existsSync(full)) {
      return full;
    }
  }
  return null;
}

function toExpressPath(openApiPath: string): string {
  return openApiPath.replace(/{(.*?)}/g, ':$1');
}

function applyTemplate(template: unknown, context: Record<string, any>): unknown {
  if (typeof template === 'string') {
    return interpolateString(template, context);
  }

  if (Array.isArray(template)) {
    return template.map(item => applyTemplate(item, context));
  }

  if (template && typeof template === 'object') {
    const result: Record<string, unknown> = {};
    Object.entries(template as Record<string, unknown>).forEach(([key, value]) => {
      result[key] = applyTemplate(value, context);
    });
    return result;
  }

  return template;
}

function interpolateString(template: string, context: Record<string, any>): string {
  return template.replace(/{{\s*([^}]+)\s*}}/g, (_match, token) => {
    const value = token.split('.').reduce((acc: any, part: string) => acc?.[part], context);
    return value !== undefined ? String(value) : '';
  });
}

function createRandomId(): string {
  return Math.random().toString(36).slice(2, 10);
}
