import express, { Request, Response, Router } from 'express';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { parse as parseYaml } from 'yaml';
import swaggerUi from 'swagger-ui-express';
import type { HandlerContext, HandlerFn, HandlerResult } from './handlers/types';

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
  handler?: string;
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
const LOG_LEVEL = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
const TIMING_ENABLED = (process.env.TIMING_ENABLED ?? 'true').toLowerCase() !== 'false';
const TIMING_LOG = (process.env.TIMING_LOG ?? 'false').toLowerCase() === 'true';
const TIMING_HEADER = process.env.TIMING_HEADER ?? 'x-virtual-response-time-ms';
const HOT_RELOAD_ENABLED = (process.env.HOT_RELOAD_ENABLED ?? 'true').toLowerCase() !== 'false';
const HOT_RELOAD_INTERVAL_MS = Number(process.env.HOT_RELOAD_INTERVAL_MS ?? 2000);
const VIRTUAL_APIS = parseCsvEnv(process.env.VIRTUAL_APIS);
const VIRTUAL_APIS_EXCLUDE = parseCsvEnv(process.env.VIRTUAL_APIS_EXCLUDE);
const resourcesRoot = process.env.VIRTUAL_RESOURCES_DIR
  ? path.resolve(process.env.VIRTUAL_RESOURCES_DIR)
  : path.resolve(__dirname, '..', 'resources');
const assetsRoot = path.resolve(__dirname, '..', 'public', 'assets');
const handlersRoot = path.resolve(__dirname, 'handlers');
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
app.use(
  morgan((tokens, req, res) => {
    const method = tokens.method(req, res);
    const url = tokens.url(req, res);
    const status = tokens.status(req, res);
    const length = tokens.res(req, res, 'content-length') ?? '-';
    const responseTime = tokens['response-time'](req, res);
    return `[api-virtual] HTTP ${method} ${url} ${status} ${length} - ${responseTime} ms`;
  })
);
if (fs.existsSync(assetsRoot)) {
  app.use('/assets', express.static(assetsRoot));
}

const logLevelOrder: Record<string, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50
};
const currentLogLevel = logLevelOrder[LOG_LEVEL] ?? logLevelOrder.info;

function log(level: 'debug' | 'info' | 'warn' | 'error', message: string) {
  if (logLevelOrder[level] < currentLogLevel) {
    return;
  }
  const prefix = `[api-virtual] ${level.toUpperCase()}`;
  switch (level) {
    case 'debug':
    case 'info':
      console.log(`${prefix} ${message}`);
      break;
    case 'warn':
      console.warn(`${prefix} ${message}`);
      break;
    case 'error':
      console.error(`${prefix} ${message}`);
      break;
  }
}

const handlerCache = new Map<string, HandlerFn>();

if (TIMING_ENABLED || TIMING_LOG) {
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    const originalEnd = res.end.bind(res);

    res.end = ((...args: Parameters<Response['end']>) => {
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      res.locals.responseTimeMs = elapsedMs;
      if (TIMING_ENABLED && !res.headersSent) {
        res.setHeader(TIMING_HEADER, elapsedMs.toFixed(2));
      }
      return originalEnd(...args);
    }) as Response['end'];

    res.on('finish', () => {
      if (!TIMING_LOG) {
        return;
      }
      const elapsedMs =
        typeof res.locals.responseTimeMs === 'number'
          ? res.locals.responseTimeMs
          : Number(process.hrtime.bigint() - start) / 1e6;
      log(
        'info',
        `Timing ${req.method} ${req.originalUrl} ${res.statusCode} ${elapsedMs.toFixed(2)}ms`
      );
    });

    next();
  });
}

log('info', `Resources root: ${resourcesRoot}`);
log('info', `Swagger enabled: ${SWAGGER_ENABLED ? 'true' : 'false'}`);
log('info', `Timing enabled: ${TIMING_ENABLED ? 'true' : 'false'}`);
log('info', `Timing log: ${TIMING_LOG ? 'true' : 'false'}`);
log('info', `Hot reload: ${HOT_RELOAD_ENABLED ? 'true' : 'false'}`);
if (VIRTUAL_APIS.length > 0) {
  log('info', `API allowlist: ${VIRTUAL_APIS.join(', ')}`);
}
if (VIRTUAL_APIS_EXCLUDE.length > 0) {
  log('info', `API denylist: ${VIRTUAL_APIS_EXCLUDE.join(', ')}`);
}

let lastResourcesFingerprint = '';
let currentState = buildAppState();
let currentRouter = currentState.router;

log('info', `Loaded ${currentState.apis.length} API(s)`);

app.use((req, res, next) => currentRouter(req, res, next));

if (SWAGGER_ENABLED) {
  app.get('/virtual/swagger', (_req, res) => {
    res.redirect('/virtual/apis/ui');
  });
  app.get('/virtual/swagger/ui', (_req, res) => {
    res.redirect('/virtual/apis/ui');
  });
  app.use('/virtual/swagger/ui', swaggerUi.serve, (_req, res, next) => {
    const urls = currentState.apis.map(api => ({
      url: `${api.basePath}/__meta/openapi`,
      name: api.name
    }));
    const setup = swaggerUi.setup(null, {
      swaggerOptions: { urls },
      customSiteTitle: 'api-virtual swagger',
      customfavIcon: '/assets/logo.svg',
      customCss: swaggerCss
    });
    return setup(_req, res, next);
  });
}

app.get('/virtual/apis', (_req, res) => {
  const payload = currentState.apis.map(api => ({
    id: api.id,
    name: api.name,
    description: api.description ?? api.openApi?.info?.description,
    basePath: api.basePath,
    operations: api.handlers.length
  }));
  res.json({
    apis: payload,
    resources: Object.keys(currentState.sharedResources.resources ?? {}),
    swaggerEnabled: SWAGGER_ENABLED
  });
});

app.get('/virtual/apis/ui', (_req, res) => {
  const items = currentState.apis
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

  const resources = Object.keys(currentState.sharedResources.resources ?? {})
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

app.post('/virtual/reload', (_req, res) => {
  const reloaded = reloadResources('manual');
  res.json({
    reloaded,
    apis: currentState.apis.length,
    resources: Object.keys(currentState.sharedResources.resources ?? {})
  });
});

if (HOT_RELOAD_ENABLED) {
  lastResourcesFingerprint = fingerprintResources(resourcesRoot);
  setInterval(() => {
    const nextFingerprint = fingerprintResources(resourcesRoot);
    if (nextFingerprint !== lastResourcesFingerprint) {
      reloadResources('watch');
    }
  }, HOT_RELOAD_INTERVAL_MS);
}

app.use((_req, res) => {
  res.status(404).json({ message: 'Not found in api-virtual' });
});

app.listen(DEFAULT_PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[api-virtual] Serving ${currentState.apis.length} API(s) from ${resourcesRoot} on port ${DEFAULT_PORT}`
  );
});

function reloadResources(trigger: 'watch' | 'manual'): boolean {
  try {
    const nextState = buildAppState();
    currentState = nextState;
    currentRouter = nextState.router;
    handlerCache.clear();
    lastResourcesFingerprint = fingerprintResources(resourcesRoot);
    log('info', `Reloaded resources (${trigger})`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Reload failed (${trigger}): ${message}`);
    return false;
  }
}

function buildAppState(): {
  sharedResources: ResourcesConfig;
  apis: VirtualApi[];
  router: Router;
} {
  const sharedResources = loadResourcesConfig(resourcesRoot);
  const apis = loadVirtualApis(resourcesRoot);
  const router = buildApisRouter(apis, sharedResources);
  return { sharedResources, apis, router };
}

function buildApisRouter(apis: VirtualApi[], sharedResources: ResourcesConfig): Router {
  const router = Router();
  apis.forEach(api => {
    const apiRouter = buildApiRouter(api, sharedResources);
    router.use(api.basePath, apiRouter);
  });
  return router;
}

function fingerprintResources(root: string): string {
  const files = collectYamlFiles(root);
  return files
    .map(file => {
      try {
        const stat = fs.statSync(file);
        return `${file}:${stat.mtimeMs}:${stat.size}`;
      } catch (error) {
        return '';
      }
    })
    .sort()
    .join('|');
}

function collectYamlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];
  entries.forEach(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectYamlFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
      results.push(fullPath);
    }
  });
  return results;
}

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
    log('debug', `Register ${method.toUpperCase()} ${api.basePath}${expressPath}`);
    const response = handler.response ?? {};

    (router as any)[method](expressPath, async (req: Request, res: Response) => {
      if (response.delayMs && response.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, response.delayMs));
      }

      const context: HandlerContext = {
        params: req.params,
        query: req.query,
        body: req.body,
        resources: sharedConfig.resources ?? {},
        meta: {
          now: new Date().toISOString(),
          randomId: createRandomId(),
          requestId:
            (req.headers['x-request-id'] as string | undefined) ?? createRandomId()
        },
        req,
        res
      };

      if (handler.handler) {
        try {
          const handlerFn = loadHandler(handler.handler);
          const result = await handlerFn(context);
          if (res.headersSent || res.writableEnded) {
            return;
          }
          if (result === undefined) {
            res.status(500).json({ message: 'Handler returned no response' });
            return;
          }
          const normalized = normalizeHandlerResult(result);
          const status = normalized.status ?? 200;
          const headers = normalized.headers ?? {};
          Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
          sendResponseBody(res, status, normalized.body);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log('error', `Handler failed for ${api.id} ${handler.path}: ${message}`);
          if (!res.headersSent) {
            res.status(500).json({ message: 'Handler execution failed', error: message });
          }
        }
        return;
      }

      const status = response.status ?? 200;
      const headers = response.headers ?? {};
      Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));

      const payload =
        response.bodyTemplate !== undefined
          ? applyTemplate(response.bodyTemplate, context)
          : response.body ?? { ok: true };

      sendResponseBody(res, status, payload);
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
    log('warn', `Resources config not found at ${configPath}`);
    return {};
  }
  const parsed = parseYamlFile<ResourcesConfig>(configPath);
  const keys = Object.keys(parsed.resources ?? {});
  log('info', `Loaded resources config (${keys.length}) from ${configPath}`);
  if (keys.length > 0) {
    log('debug', `Resources keys: ${keys.join(', ')}`);
  }
  return parsed;
}

function loadVirtualApis(root: string): VirtualApi[] {
  const apisDir = path.join(root, 'apis');
  if (!fs.existsSync(apisDir)) {
    log('warn', `APIs directory not found at ${apisDir}`);
    return [];
  }

  let entries = fs.readdirSync(apisDir, { withFileTypes: true }).filter(dirent =>
    dirent.isDirectory()
  );

  if (VIRTUAL_APIS.length > 0) {
    const allowed = new Set(VIRTUAL_APIS);
    entries = entries.filter(entry => allowed.has(entry.name));
  }
  if (VIRTUAL_APIS_EXCLUDE.length > 0) {
    const denied = new Set(VIRTUAL_APIS_EXCLUDE);
    entries = entries.filter(entry => !denied.has(entry.name));
  }

  log('info', `Found ${entries.length} API folder(s) under ${apisDir}`);

  return entries.map(entry => {
    const apiId = entry.name;
    const apiDir = path.join(apisDir, apiId);
    log('debug', `Loading API ${apiId} from ${apiDir}`);

    const openApiPath = resolveFirstExisting(apiDir, ['openapi.yaml', 'openapi.yml']);
    if (!openApiPath) {
      log('error', `Missing openapi.yaml in ${apiDir}`);
      throw new Error(`Missing openapi.yaml in ${apiDir}`);
    }

    log('debug', `OpenAPI: ${openApiPath}`);

    const openApi = parseYamlFile<any>(openApiPath);
    const handlersBundle = loadHandlersBundle(apiDir, apiId);

    if (handlersBundle.sources.primary) {
      log('debug', `Handlers: ${handlersBundle.sources.primary}`);
    }
    if (handlersBundle.sources.extras.length > 0) {
      log('debug', `Extra handlers: ${handlersBundle.sources.extras.join(', ')}`);
    }

    const basePath = resolveBasePath(apiId, handlersBundle.api?.basePath, openApi);
    const name =
      handlersBundle.api?.name ??
      openApi?.info?.title ??
      `Virtual API ${apiId}`;

    const handlers = normalizeHandlers(handlersBundle.routes ?? []);

    log('info', `Loaded ${apiId} (${handlers.length} route(s)) at ${basePath}`);

    return {
      id: apiId,
      name,
      description: handlersBundle.api?.description ?? openApi?.info?.description,
      basePath,
      openApiPath,
      openApi,
      handlers
    };
  });
}

function parseCsvEnv(value?: string): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function loadHandlersBundle(apiDir: string, apiId: string): {
  api?: ApiMetadata;
  routes: HandlerDefinition[];
  sources: { primary?: string; extras: string[] };
} {
  const handlersPath = resolveFirstExisting(apiDir, ['handlers.yaml', 'handlers.yml']);
  let handlersFile: HandlersFile | null = null;

  if (handlersPath) {
    handlersFile = parseYamlFile<HandlersFile>(handlersPath);
  }

  const handlersDir = path.join(apiDir, 'handlers');
  const extras: string[] = [];
  const extraRoutes: HandlerDefinition[] = [];

  if (fs.existsSync(handlersDir)) {
    const files = fs
      .readdirSync(handlersDir)
      .filter(file => file.endsWith('.yaml') || file.endsWith('.yml'))
      .sort((a, b) => a.localeCompare(b));

    files.forEach(file => {
      const filePath = path.join(handlersDir, file);
      const parsed = parseYamlFile<HandlersFile>(filePath);
      if (parsed.api) {
        log(
          'warn',
          `Ignoring api metadata in ${filePath} (use ${handlersPath ?? 'handlers.yaml'})`
        );
      }
      if (parsed.routes && parsed.routes.length > 0) {
        extraRoutes.push(...parsed.routes);
      }
      extras.push(filePath);
    });
  }

  if (!handlersPath && extraRoutes.length === 0) {
    log('error', `Missing handlers.yaml or handlers/ in ${apiDir}`);
    throw new Error(`Missing handlers.yaml or handlers/ in ${apiDir}`);
  }

  return {
    api: handlersFile?.api,
    routes: [...(handlersFile?.routes ?? []), ...extraRoutes],
    sources: {
      primary: handlersPath ?? undefined,
      extras
    }
  };
}

function parseYamlFile<T>(filePath: string): T {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return parseYaml(raw) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Failed parsing YAML ${filePath}: ${message}`);
    throw error;
  }
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

function loadHandler(handlerId: string): HandlerFn {
  const cached = handlerCache.get(handlerId);
  if (cached) {
    return cached;
  }
  const resolvedPath = resolveHandlerPath(handlerId);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(resolvedPath);
  const handler = mod?.default ?? mod?.handler ?? mod;
  if (typeof handler !== 'function') {
    throw new Error(`Handler module ${handlerId} does not export a function`);
  }
  handlerCache.set(handlerId, handler as HandlerFn);
  return handler as HandlerFn;
}

function resolveHandlerPath(handlerId: string): string {
  const hasExt = path.extname(handlerId);
  const candidates = hasExt
    ? [handlerId]
    : [
        `${handlerId}.js`,
        `${handlerId}.ts`,
        path.join(handlerId, 'index.js'),
        path.join(handlerId, 'index.ts')
      ];

  for (const candidate of candidates) {
    const fullPath = path.isAbsolute(candidate)
      ? candidate
      : path.join(handlersRoot, candidate);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  throw new Error(`Handler module not found for "${handlerId}" in ${handlersRoot}`);
}

function normalizeHandlerResult(result: unknown): HandlerResult {
  if (result && typeof result === 'object') {
    const maybe = result as HandlerResult;
    if ('status' in maybe || 'headers' in maybe || 'body' in maybe) {
      return maybe;
    }
  }
  return { body: result };
}

function sendResponseBody(res: Response, status: number, body: unknown) {
  if (body === undefined) {
    res.status(status).end();
    return;
  }
  if (Buffer.isBuffer(body) || typeof body === 'string') {
    res.status(status).send(body);
    return;
  }
  res.status(status).json(body);
}
