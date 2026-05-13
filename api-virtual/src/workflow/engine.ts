import { URL } from 'node:url';
import mysql from 'mysql2/promise';
import type { HandlerContext, HandlerResult } from '../handlers/types';

interface WorkflowResponse {
  status?: unknown;
  headers?: unknown;
  body?: unknown;
  bodyTemplate?: unknown;
}

export interface WorkflowDefinition {
  steps: WorkflowStep[];
  response?: WorkflowResponse;
}

type WorkflowStep =
  | {
      when?: unknown;
      set: string;
      value?: unknown;
      valueTemplate?: unknown;
    }
  | {
      when?: unknown;
      append: string;
      value?: unknown;
      valueTemplate?: unknown;
    }
  | {
      when?: unknown;
      forEach: unknown;
      as?: string;
      indexAs?: string;
      steps: WorkflowStep[];
    }
  | {
      when?: unknown;
      action: string;
      input?: unknown;
      saveAs?: string;
    };

interface WorkflowRuntime {
  context: HandlerContext;
  vars: Record<string, unknown>;
}

interface ActionInput {
  [key: string]: unknown;
}

interface OpensearchRequestOptions {
  endpoint: string;
  method: string;
  path: string;
  body?: unknown;
  contentType?: string;
  allowNotFound?: boolean;
}

interface OpensearchResponse {
  status: number;
  body: unknown;
}

export class WorkflowHttpError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(typeof body === 'string' ? body : `Workflow failed with status ${status}`);
    this.name = 'WorkflowHttpError';
    this.status = status;
    this.body = body;
  }
}

export async function executeWorkflow(
  workflow: WorkflowDefinition,
  context: HandlerContext
): Promise<HandlerResult> {
  const runtime: WorkflowRuntime = {
    context,
    vars: {}
  };

  await executeSteps(workflow.steps ?? [], runtime, {});

  const response = workflow.response ?? {};
  const rawStatus =
    response.status !== undefined ? resolveTemplate(response.status, runtime, {}) : 200;
  const status = asNumber(rawStatus, 200);
  const headers = asStringRecord(resolveTemplate(response.headers ?? {}, runtime, {}));
  const body =
    response.bodyTemplate !== undefined
      ? resolveTemplate(response.bodyTemplate, runtime, {})
      : response.body ?? { ok: true };

  return {
    status,
    headers,
    body
  };
}

async function executeSteps(
  steps: WorkflowStep[],
  runtime: WorkflowRuntime,
  scope: Record<string, unknown>
): Promise<void> {
  for (const step of steps) {
    if (!evaluateStepGuard(step.when, runtime, scope)) {
      continue;
    }

    if ('forEach' in step) {
      const rawItems = resolveTemplate(step.forEach, runtime, scope);
      const items = Array.isArray(rawItems) ? rawItems : [];
      const as = step.as ?? 'item';
      const indexAs = step.indexAs ?? 'index';
      for (let index = 0; index < items.length; index += 1) {
        const itemScope: Record<string, unknown> = {
          ...scope,
          [as]: items[index],
          [indexAs]: index,
          item: items[index],
          index
        };
        await executeSteps(step.steps ?? [], runtime, itemScope);
      }
      continue;
    }

    if ('set' in step) {
      const value =
        step.valueTemplate !== undefined
          ? resolveTemplate(step.valueTemplate, runtime, scope)
          : step.value;
      setVarByPath(runtime.vars, normalizeVarPath(step.set), value);
      continue;
    }

    if ('append' in step) {
      const value =
        step.valueTemplate !== undefined
          ? resolveTemplate(step.valueTemplate, runtime, scope)
          : step.value;
      appendVarByPath(runtime.vars, normalizeVarPath(step.append), value);
      continue;
    }

    if ('action' in step) {
      const input = resolveTemplate(step.input, runtime, scope);
      const output = await executeAction(step.action, input, runtime, scope);
      if (step.saveAs) {
        setVarByPath(runtime.vars, normalizeVarPath(step.saveAs), output);
      }
      continue;
    }
  }
}

function evaluateStepGuard(
  when: unknown,
  runtime: WorkflowRuntime,
  scope: Record<string, unknown>
): boolean {
  if (when === undefined) {
    return true;
  }
  const value = resolveTemplate(when, runtime, scope);
  return Boolean(value);
}

async function executeAction(
  action: string,
  rawInput: unknown,
  runtime: WorkflowRuntime,
  scope: Record<string, unknown>
): Promise<unknown> {
  const input = asRecord(rawInput);

  switch (action) {
    case 'util.makeId':
      return actionUtilMakeId(input);
    case 'util.toInt':
      return actionUtilToInt(input);
    case 'util.math':
      return actionUtilMath(input);
    case 'util.coalesce':
      return actionUtilCoalesce(input);
    case 'util.boolToInt':
      return actionUtilBoolToInt(input);
    case 'util.require':
      return actionUtilRequire(input);
    case 'util.extractSearch':
      return actionUtilExtractSearch(input);
    case 'util.buildFilters':
      return actionUtilBuildFilters(input);
    case 'util.toBoolQuery':
      return actionUtilToBoolQuery(input);
    case 'util.select':
      return actionUtilSelect(input);
    case 'util.parseJson':
      return actionUtilParseJson(input);
    case 'util.toJson':
      return actionUtilToJson(input);
    case 'util.generateNetwinSimulation':
      return actionUtilGenerateNetwinSimulation(input, runtime, scope);
    case 'mysql.query':
      return actionMysqlQuery(input, runtime);
    case 'mysql.first':
      return actionMysqlFirst(input, runtime);
    case 'stub.resolveCase':
      return actionStubResolveCase(input, runtime);
    case 'opensearch.search':
      return actionOpenSearchSearch(input, runtime);
    case 'opensearch.count':
      return actionOpenSearchCount(input, runtime);
    case 'opensearch.get':
      return actionOpenSearchGet(input, runtime);
    case 'opensearch.index':
      return actionOpenSearchIndex(input, runtime);
    case 'opensearch.bulk':
      return actionOpenSearchBulk(input, runtime);
    case 'opensearch.delete':
      return actionOpenSearchDelete(input, runtime);
    case 'opensearch.deleteByQuery':
      return actionOpenSearchDeleteByQuery(input, runtime);
    default:
      throw new WorkflowHttpError(500, {
        message: `Unknown workflow action: ${action}`
      });
  }
}

async function actionMysqlQuery(
  input: ActionInput,
  runtime: WorkflowRuntime
): Promise<{ rows: unknown[]; rowCount: number }> {
  const connectionOptions = resolveMysqlConnectionOptions(input, runtime.context.resources);
  const sql = asString(input.sql, '').trim();
  if (!sql) {
    throw new WorkflowHttpError(500, { message: 'mysql.query requires sql' });
  }
  const params = normalizeSqlParams(input.params);
  const connection = await mysql.createConnection(connectionOptions);
  try {
    const [rows] = await connection.query(sql, params as any);
    const normalizedRows = Array.isArray(rows) ? rows : [];
    return {
      rows: normalizedRows as unknown[],
      rowCount: normalizedRows.length
    };
  } finally {
    await connection.end();
  }
}

async function actionMysqlFirst(
  input: ActionInput,
  runtime: WorkflowRuntime
): Promise<unknown | null> {
  const result = await actionMysqlQuery(input, runtime);
  return result.rows[0] ?? null;
}

async function actionStubResolveCase(
  input: ActionInput,
  runtime: WorkflowRuntime
): Promise<{ status: number; headers: Record<string, string>; body: unknown; caseId?: number } | null> {
  const resource = asString(input.resource, 'stubRuntimeMysql');
  const api = asString(input.api, '');
  const method = asString(input.method, runtime.context.req.method).toUpperCase();
  const pathTemplate = asString(input.path, runtime.context.req.route?.path ?? runtime.context.req.path);
  const result = await actionMysqlQuery(
    {
      resource,
      sql: `
        SELECT id, priority, match_json
        FROM stub_cases
        WHERE enabled = 1
          AND api_id = :api
          AND method = :method
          AND path_template = :pathTemplate
        ORDER BY priority DESC, id ASC
      `,
      params: { api, method, pathTemplate }
    },
    runtime
  );

  for (const row of result.rows) {
    const candidate = asRecord(row);
    const matcher = parseJsonObject(candidate.match_json);
    if (!matchesRequest(matcher, runtime)) {
      continue;
    }
    const payloadResult = await actionMysqlFirst(
      {
        resource,
        sql: `
          SELECT response_status, response_headers, response_payload
          FROM stub_cases
          WHERE id = :id
        `,
        params: { id: candidate.id }
      },
      runtime
    );
    const payloadRow = asRecord(payloadResult);
    return {
      caseId: asNumber(candidate.id, 0),
      status: asNumber(payloadRow.response_status, 200),
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        ...parseJsonObject(payloadRow.response_headers)
      },
      body: parseJsonValue(payloadRow.response_payload)
    };
  }

  return null;
}

function matchesRequest(matcher: Record<string, unknown>, runtime: WorkflowRuntime): boolean {
  const context = {
    params: runtime.context.params,
    query: runtime.context.query,
    body: runtime.context.body
  };
  for (const [pathValue, expected] of Object.entries(matcher)) {
    const actual = getByPath(context, pathValue);
    if (expected === undefined || expected === null || expected === '') {
      continue;
    }
    if (String(actual ?? '') !== String(expected)) {
      return false;
    }
  }
  return true;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  const parsed = parseJsonValue(value);
  return isRecord(parsed) ? parsed : {};
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value ?? null;
  }
  try {
    return JSON.parse(value);
  } catch (_error) {
    return value;
  }
}

function actionUtilMakeId(input: ActionInput): string {
  const prefix = asString(input.prefix, 'id');
  const parts = Array.isArray(input.parts) ? input.parts : [];
  const compact = parts
    .map(part => asString(part, ''))
    .join('')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 12)
    .toLowerCase();
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${compact || 'x'}_${random}`;
}

function actionUtilToInt(input: ActionInput): number {
  const fallback = asNumber(input.default, 0);
  let value = asNumber(input.value, fallback);
  if (!Number.isFinite(value)) {
    value = fallback;
  }
  value = Math.floor(value);
  if (input.min !== undefined) {
    value = Math.max(value, asNumber(input.min, value));
  }
  if (input.max !== undefined) {
    value = Math.min(value, asNumber(input.max, value));
  }
  return value;
}

function actionUtilMath(input: ActionInput): number {
  const op = asString(input.op, 'add');
  const a = asNumber(input.a, 0);
  const b = asNumber(input.b, 0);
  switch (op) {
    case 'add':
      return a + b;
    case 'sub':
      return a - b;
    case 'mul':
      return a * b;
    case 'div':
      return b === 0 ? 0 : a / b;
    case 'max':
      return Math.max(a, b);
    case 'min':
      return Math.min(a, b);
    default:
      return a + b;
  }
}

function actionUtilCoalesce(input: ActionInput): unknown {
  const values = Array.isArray(input.values) ? input.values : [];
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return input.default;
}

function actionUtilBoolToInt(input: ActionInput): number {
  return Boolean(input.value) ? 1 : 0;
}

function actionUtilRequire(input: ActionInput): { ok: true } {
  const condition = Boolean(input.condition);
  if (condition) {
    return { ok: true };
  }
  const status = asNumber(input.status, 400);
  const message = asString(input.message, 'Validation failed');
  throw new WorkflowHttpError(status, { message });
}

function actionUtilExtractSearch(input: ActionInput): {
  total: number;
  hits: unknown[];
  sources: unknown[];
} {
  const payload = asRecord(input.searchResult);
  const hitsWrapper = asRecord(payload.hits);
  const totalRaw = hitsWrapper.total;
  const total =
    typeof totalRaw === 'number'
      ? totalRaw
      : asNumber(asRecord(totalRaw).value, 0);
  const hits = Array.isArray(hitsWrapper.hits) ? hitsWrapper.hits : [];
  const sources = hits
    .map(hit => asRecord(hit)._source)
    .filter(item => item !== undefined);
  return {
    total,
    hits,
    sources
  };
}

function actionUtilBuildFilters(input: ActionInput): unknown[] {
  const items = Array.isArray(input.items) ? input.items : [];
  const filters: unknown[] = [];

  for (const item of items) {
    const cfg = asRecord(item);
    const type = asString(cfg.type, 'term');
    if (type === 'term') {
      const field = asString(cfg.field, '');
      const value = cfg.value;
      if (!field || value === undefined || value === null || value === '') {
        continue;
      }
      filters.push({
        term: {
          [field]: value
        }
      });
      continue;
    }

    if (type === 'range') {
      const field = asString(cfg.field, '');
      if (!field) {
        continue;
      }
      const range: Record<string, unknown> = {};
      if (cfg.gte !== undefined && cfg.gte !== null && cfg.gte !== '') {
        range.gte = cfg.gte;
      }
      if (cfg.lte !== undefined && cfg.lte !== null && cfg.lte !== '') {
        range.lte = cfg.lte;
      }
      if (Object.keys(range).length === 0) {
        continue;
      }
      filters.push({
        range: {
          [field]: range
        }
      });
    }
  }

  return filters;
}

function actionUtilToBoolQuery(input: ActionInput): Record<string, unknown> {
  const filters = Array.isArray(input.filters) ? input.filters : [];
  if (filters.length === 0) {
    return { match_all: {} };
  }
  return {
    bool: {
      filter: filters
    }
  };
}

function actionUtilSelect(input: ActionInput): unknown {
  const key = asString(input.key, '');
  const options = asRecord(input.options);
  if (key && Object.prototype.hasOwnProperty.call(options, key)) {
    return options[key];
  }
  return input.default;
}

function actionUtilParseJson(input: ActionInput): unknown {
  const value = input.value;
  if (typeof value !== 'string') {
    return value ?? input.default ?? null;
  }
  try {
    return JSON.parse(value);
  } catch (_error) {
    return input.default ?? null;
  }
}

function actionUtilToJson(input: ActionInput): string {
  return JSON.stringify(input.value ?? null);
}

function resolveMysqlConnectionOptions(
  input: ActionInput,
  resources: Record<string, unknown>
): mysql.ConnectionOptions {
  const resourceName = asString(input.resource, 'mysql');
  const resource = asRecord(resources[resourceName]);
  const host = resolveEnvBackedString(resource, 'host', 'hostEnv', 'localhost');
  const port = asNumber(resolveEnvBackedString(resource, 'port', 'portEnv', 3306), 3306);
  const user = resolveEnvBackedString(resource, 'user', 'userEnv', 'root');
  const password = resolveEnvBackedString(resource, 'password', 'passwordEnv', '');
  const database = asString(input.database, '')
    || resolveEnvBackedString(resource, 'database', 'databaseEnv', '');

  return {
    host,
    port,
    user,
    password,
    database: database || undefined,
    namedPlaceholders: true,
    decimalNumbers: false,
    supportBigNumbers: true,
    bigNumberStrings: true
  };
}

function resolveEnvBackedString(
  source: Record<string, unknown>,
  valueKey: string,
  envKey: string,
  fallback: unknown
): string {
  const envName = asString(source[envKey], '');
  if (envName) {
    const envValue = process.env[envName];
    if (envValue !== undefined && envValue !== '') {
      return envValue;
    }
  }
  return asString(source[valueKey], asString(fallback, ''));
}

function normalizeSqlParams(value: unknown): unknown[] | Record<string, unknown> {
  if (Array.isArray(value)) {
    return value;
  }
  if (isRecord(value)) {
    return value;
  }
  return [];
}

function actionUtilGenerateNetwinSimulation(
  input: ActionInput,
  runtime: WorkflowRuntime,
  _scope: Record<string, unknown>
): {
  dailyDocs: Array<Record<string, unknown>>;
  betDocs: Array<Record<string, unknown>>;
} {
  const playerId = asString(input.playerId, '');
  const affiliateId = asString(input.affiliateId, '');
  const currency = asString(input.currency, 'DOP');
  const now = parseDate(asString(input.now, runtime.context.meta.now));

  const days = clamp(asNumber(input.days, 14), 3, 120);
  const betsPerDay = clamp(asNumber(input.betsPerDay, 3), 1, 12);

  const anchor = startOfUtcDay(now);
  const dailyDocs: Array<Record<string, unknown>> = [];
  const betDocs: Array<Record<string, unknown>> = [];

  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    const date = new Date(anchor);
    date.setUTCDate(date.getUTCDate() - dayOffset);
    const dayKey = date.toISOString().slice(0, 10).replace(/-/g, '');

    const coinIn = randInt(15000, 140000);
    const netwin = randInt(-Math.floor(coinIn * 0.25), Math.floor(coinIn * 0.35));
    const coinOut = Math.max(0, coinIn - netwin);
    const operationCount = randInt(6, 90);

    dailyDocs.push({
      id: `${playerId}_${dayKey}`,
      date: date.toISOString(),
      affiliateId,
      playerId,
      currency,
      netwin,
      coinIn,
      coinOut,
      operationCount,
      createdAt: runtime.context.meta.now,
      updatedAt: runtime.context.meta.now
    });

    for (let betIdx = 0; betIdx < betsPerDay; betIdx += 1) {
      const placedAt = new Date(date);
      placedAt.setUTCHours(randInt(0, 23), randInt(0, 59), randInt(0, 59), 0);
      const stake = randInt(30, 5000);
      const payout = randInt(0, stake * 2);
      const betNetwin = stake - payout;

      betDocs.push({
        id: `${playerId}_${dayKey}_${betIdx + 1}`,
        playerId,
        affiliateId,
        currency,
        stake,
        payout,
        netwin: betNetwin,
        status: payout > stake ? 'WIN' : payout < stake ? 'LOSS' : 'PUSH',
        createdAt: placedAt.toISOString(),
        updatedAt: runtime.context.meta.now
      });
    }
  }

  return { dailyDocs, betDocs };
}

async function actionOpenSearchSearch(
  input: ActionInput,
  runtime: WorkflowRuntime
): Promise<unknown> {
  const endpoint = resolveOpenSearchEndpoint(input, runtime.context.resources);
  const index = asString(input.index, '');
  const body = asRecord(input.body);
  const response = await openSearchRequest({
    endpoint,
    method: 'POST',
    path: `/${encodeURIComponent(index)}/_search`,
    body,
    allowNotFound: true
  });
  if (response.status === 404) {
    return {
      hits: {
        total: { value: 0, relation: 'eq' },
        hits: []
      },
      aggregations: {}
    };
  }
  return response.body;
}

async function actionOpenSearchCount(
  input: ActionInput,
  runtime: WorkflowRuntime
): Promise<unknown> {
  const endpoint = resolveOpenSearchEndpoint(input, runtime.context.resources);
  const index = asString(input.index, '');
  const query = input.query ?? { match_all: {} };
  const response = await openSearchRequest({
    endpoint,
    method: 'POST',
    path: `/${encodeURIComponent(index)}/_count`,
    body: { query },
    allowNotFound: true
  });
  if (response.status === 404) {
    return { count: 0 };
  }
  return response.body;
}

async function actionOpenSearchGet(
  input: ActionInput,
  runtime: WorkflowRuntime
): Promise<unknown> {
  const endpoint = resolveOpenSearchEndpoint(input, runtime.context.resources);
  const index = asString(input.index, '');
  const id = asString(input.id, '');
  const response = await openSearchRequest({
    endpoint,
    method: 'GET',
    path: `/${encodeURIComponent(index)}/_doc/${encodeURIComponent(id)}`,
    allowNotFound: true
  });
  if (response.status === 404) {
    return { found: false, source: null };
  }
  const payload = asRecord(response.body);
  return {
    found: true,
    source: payload._source ?? null,
    raw: response.body
  };
}

async function actionOpenSearchIndex(
  input: ActionInput,
  runtime: WorkflowRuntime
): Promise<unknown> {
  const resourceName = asString(input.resource, 'opensearch');
  const endpoint = resolveOpenSearchEndpoint(input, runtime.context.resources);
  const index = asString(input.index, '');
  const id = asString(input.id, '');
  const document = asRecord(input.document);
  const ensureIndex = input.ensureIndex !== false;
  const definition = resolveOpenSearchIndexDefinition(
    runtime.context.resources,
    resourceName,
    index
  );

  if (ensureIndex) {
    await ensureOpenSearchIndex(endpoint, index, definition);
  }

  const put = async () =>
    openSearchRequest({
      endpoint,
      method: 'PUT',
      path: `/${encodeURIComponent(index)}/_doc/${encodeURIComponent(id)}?refresh=wait_for`,
      body: document
    });

  try {
    const response = await put();
    return response.body;
  } catch (error) {
    if (error instanceof WorkflowHttpError && error.status === 404) {
      await ensureOpenSearchIndex(endpoint, index, definition);
      const response = await put();
      return response.body;
    }
    throw error;
  }
}

async function actionOpenSearchBulk(
  input: ActionInput,
  runtime: WorkflowRuntime
): Promise<unknown> {
  const resourceName = asString(input.resource, 'opensearch');
  const endpoint = resolveOpenSearchEndpoint(input, runtime.context.resources);
  const index = asString(input.index, '');
  const documents = Array.isArray(input.documents) ? input.documents : [];
  const ensureIndex = input.ensureIndex !== false;
  const definition = resolveOpenSearchIndexDefinition(
    runtime.context.resources,
    resourceName,
    index
  );

  if (documents.length === 0) {
    return { took: 0, errors: false, items: [] };
  }

  if (ensureIndex) {
    await ensureOpenSearchIndex(endpoint, index, definition);
  }

  const buildPayload = (): string =>
    documents
      .map(raw => {
        const doc = asRecord(raw);
        const id = asString(doc.id ?? doc._id, createRandomId());
        const bodyCandidate = doc.document;
        const body =
          bodyCandidate !== undefined
            ? asRecord(bodyCandidate)
            : omitKeys(doc, ['id', '_id']);
        const op = JSON.stringify({ index: { _index: index, _id: id } });
        return `${op}\n${JSON.stringify(body)}\n`;
      })
      .join('');

  const execute = async (): Promise<OpensearchResponse> =>
    openSearchRequest({
      endpoint,
      method: 'POST',
      path: '/_bulk?refresh=wait_for',
      body: buildPayload(),
      contentType: 'application/x-ndjson'
    });

  try {
    const response = await execute();
    return response.body;
  } catch (error) {
    if (error instanceof WorkflowHttpError && error.status === 404) {
      await ensureOpenSearchIndex(endpoint, index, definition);
      const response = await execute();
      return response.body;
    }
    throw error;
  }
}

async function actionOpenSearchDelete(
  input: ActionInput,
  runtime: WorkflowRuntime
): Promise<unknown> {
  const endpoint = resolveOpenSearchEndpoint(input, runtime.context.resources);
  const index = asString(input.index, '');
  const id = asString(input.id, '');
  const response = await openSearchRequest({
    endpoint,
    method: 'DELETE',
    path: `/${encodeURIComponent(index)}/_doc/${encodeURIComponent(id)}?refresh=wait_for`,
    allowNotFound: true
  });
  if (response.status === 404) {
    return { deleted: false, result: 'not_found' };
  }
  const payload = asRecord(response.body);
  return {
    deleted: payload.result === 'deleted',
    result: payload.result ?? 'unknown'
  };
}

async function actionOpenSearchDeleteByQuery(
  input: ActionInput,
  runtime: WorkflowRuntime
): Promise<unknown> {
  const endpoint = resolveOpenSearchEndpoint(input, runtime.context.resources);
  const index = asString(input.index, '');
  const query = input.query ?? { match_all: {} };

  const response = await openSearchRequest({
    endpoint,
    method: 'POST',
    path: `/${encodeURIComponent(index)}/_delete_by_query?refresh=true&conflicts=proceed`,
    body: { query },
    allowNotFound: true
  });
  if (response.status === 404) {
    return { deleted: 0 };
  }
  const payload = asRecord(response.body);
  return {
    deleted: asNumber(payload.deleted, 0)
  };
}

async function openSearchRequest(
  options: OpensearchRequestOptions
): Promise<OpensearchResponse> {
  const response = await fetch(`${options.endpoint}${options.path}`, {
    method: options.method,
    headers: options.body
      ? {
          'content-type': options.contentType ?? 'application/json'
        }
      : undefined,
    body:
      options.body === undefined
        ? undefined
        : options.contentType === 'application/x-ndjson'
          ? String(options.body)
          : JSON.stringify(options.body)
  });

  const rawText = await response.text();
  const body = tryParseJson(rawText);

  if (!response.ok && !(options.allowNotFound && response.status === 404)) {
    const errorMessage = extractOpensearchErrorMessage(body);
    throw new WorkflowHttpError(500, {
      message: `OpenSearch ${options.method} ${options.path} failed with status ${response.status}${errorMessage ? `: ${errorMessage}` : ''}`,
      details: body
    });
  }

  return {
    status: response.status,
    body
  };
}

function extractOpensearchErrorMessage(body: unknown): string | undefined {
  const payload = asRecord(body);
  const error = asRecord(payload.error);
  const reason = error.reason;
  return typeof reason === 'string' ? reason : undefined;
}

function tryParseJson(text: string): unknown {
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (_error) {
    return text;
  }
}

function resolveOpenSearchEndpoint(
  input: ActionInput,
  resources: Record<string, unknown>
): string {
  const resourceName = asString(input.resource, 'opensearch');
  const rawResource = asRecord(resources[resourceName]);
  const rawEndpoint = asString(rawResource.endpoint, 'http://localhost:9200');

  let parsed: URL;
  try {
    parsed = new URL(rawEndpoint);
  } catch (_error) {
    parsed = new URL('http://localhost:9200');
  }

  const envHost = process.env.OPENSEARCH_HOST?.trim();
  const envPort = process.env.OPENSEARCH_PORT?.trim();
  if (envHost && isLocalHost(parsed.hostname) && !isLocalHost(envHost)) {
    parsed.hostname = envHost;
  }
  if (envPort && (!parsed.port || parsed.port === '9200')) {
    parsed.port = envPort;
  }
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function resolveOpenSearchIndexDefinition(
  resources: Record<string, unknown>,
  resourceName: string,
  index: string
): Record<string, unknown> | undefined {
  const resource = asRecord(resources[resourceName]);
  const definitions = asRecord(resource.indexDefinitions);
  const candidate = definitions[index];
  if (isRecord(candidate)) {
    return candidate;
  }
  return undefined;
}

async function ensureOpenSearchIndex(
  endpoint: string,
  index: string,
  definition?: Record<string, unknown>
): Promise<void> {
  const response = await fetch(`${endpoint}/${encodeURIComponent(index)}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(definition ?? {})
  });

  const rawText = await response.text();
  const body = tryParseJson(rawText);

  if (response.ok) {
    return;
  }

  const error = asRecord(asRecord(body).error);
  if (
    response.status === 400 &&
    asString(error.type, '') === 'resource_already_exists_exception'
  ) {
    return;
  }

  const reason = asString(error.reason, '');
  throw new WorkflowHttpError(500, {
    message: `OpenSearch ensure index ${index} failed with status ${response.status}${reason ? `: ${reason}` : ''}`,
    details: body
  });
}

function isLocalHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1';
}

function resolveTemplate(
  template: unknown,
  runtime: WorkflowRuntime,
  scope: Record<string, unknown>
): unknown {
  if (typeof template === 'string') {
    return resolveTemplateString(template, runtime, scope);
  }

  if (Array.isArray(template)) {
    return template.map(item => resolveTemplate(item, runtime, scope));
  }

  if (isRecord(template)) {
    const result: Record<string, unknown> = {};
    Object.entries(template).forEach(([key, value]) => {
      result[key] = resolveTemplate(value, runtime, scope);
    });
    return result;
  }

  return template;
}

function resolveTemplateString(
  template: string,
  runtime: WorkflowRuntime,
  scope: Record<string, unknown>
): unknown {
  const exact = template.match(/^{{\s*([^}]+)\s*}}$/);
  if (exact) {
    return resolveToken(exact[1], runtime, scope);
  }
  return template.replace(/{{\s*([^}]+)\s*}}/g, (_match, token: string) => {
    const value = resolveToken(token, runtime, scope);
    return value === undefined || value === null ? '' : String(value);
  });
}

function resolveToken(
  token: string,
  runtime: WorkflowRuntime,
  scope: Record<string, unknown>
): unknown {
  const trimmed = token.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (trimmed === 'null') {
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  const root: Record<string, unknown> = {
    ...scope,
    params: runtime.context.params,
    query: runtime.context.query,
    body: runtime.context.body,
    resources: runtime.context.resources,
    meta: runtime.context.meta,
    vars: runtime.vars
  };

  return getByPath(root, trimmed);
}

function getByPath(source: unknown, pathValue: string): unknown {
  const pathParts = pathValue.split('.').filter(Boolean);
  let current: unknown = source;
  for (const part of pathParts) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (Number.isInteger(index)) {
        current = current[index];
        continue;
      }
      const arrayLike = current as unknown as Record<string, unknown>;
      current = arrayLike[part];
      continue;
    }
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function setVarByPath(target: Record<string, unknown>, pathValue: string, value: unknown): void {
  const parts = pathValue.split('.').filter(Boolean);
  if (parts.length === 0) {
    return;
  }
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const next = cursor[key];
    if (isRecord(next)) {
      cursor = next;
      continue;
    }
    const created: Record<string, unknown> = {};
    cursor[key] = created;
    cursor = created;
  }
  cursor[parts[parts.length - 1]] = value;
}

function appendVarByPath(target: Record<string, unknown>, pathValue: string, value: unknown): void {
  const existing = getByPath(target, pathValue);
  if (!Array.isArray(existing)) {
    setVarByPath(target, pathValue, [value]);
    return;
  }
  existing.push(value);
}

function normalizeVarPath(pathValue: string): string {
  return pathValue.replace(/^vars\./, '').trim();
}

function parseDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0)
  );
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function createRandomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

function asStringRecord(value: unknown): Record<string, string> {
  const source = asRecord(value);
  const result: Record<string, string> = {};
  Object.entries(source).forEach(([key, item]) => {
    result[key] = asString(item, '');
  });
  return result;
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function omitKeys(
  source: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> {
  const deny = new Set(keys);
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => !deny.has(key))
  );
}
