import axios from 'axios';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Command } from 'commander';
import YAML from 'yaml';

import { resolveEnvironment } from '../config';

const DEFAULT_OPENSEARCH_URL = process.env.OPENSEARCH_URL || 'http://localhost:9200';
const DEFAULT_OPENSEARCH_USER = process.env.OPENSEARCH_USER;
const DEFAULT_OPENSEARCH_PASSWORD = process.env.OPENSEARCH_PASSWORD;
const RESOURCES_ROOT = path.resolve(__dirname, '..', '..', 'resources');
const DEFAULT_OPERATIONS_BULK = path.join(
  RESOURCES_ROOT,
  'napa',
  'seeds',
  'opensearch',
  'operations.ndjson'
);

type OpensearchBaseOptions = {
  endpoint: string;
};

type OpensearchLoadOptions = OpensearchBaseOptions & {
  index?: string;
  dryRun?: boolean;
};

type OpensearchCreateIndexOptions = OpensearchBaseOptions & {
  body?: string;
};

type OpensearchSeedOperationsOptions = OpensearchBaseOptions & {
  index?: string;
  bulkFile?: string;
  waitSeconds?: number;
  reset?: boolean;
  dynamicIds?: boolean;
  dynamicTimestamps?: boolean;
};

type OpensearchInsertOptions = OpensearchBaseOptions & {
  id?: string;
};

type OpensearchDescribeIndexOptions = OpensearchBaseOptions & {
  mappings?: boolean;
  settings?: boolean;
  format?: 'pretty' | 'compact';
  unwrap?: boolean;
  table?: boolean;
};

type OpensearchListIndicesOptions = OpensearchBaseOptions & {
  format?: 'json' | 'table';
};

type OpensearchSearchOptions = OpensearchBaseOptions & {
  file?: string;
  q?: string;
  size?: number;
  from?: number;
  table?: boolean;
  fields?: string;
};

type OpensearchDeleteOptions = OpensearchBaseOptions & {
  yes?: boolean;
};

type OpensearchExportOptions = OpensearchBaseOptions & {
  mappings?: boolean;
  settings?: boolean;
  format?: 'json' | 'yaml';
  output?: string;
};

async function confirmAction(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`${message} (y/N) `);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

const NDJSON_EXTENSIONS = new Set(['.ndjson', '.jsonl']);
const YAML_EXTENSIONS = new Set(['.yaml', '.yml']);

function normalizeBulkEndpoint(endpoint: string): string {
  const trimmed = endpoint.replace(/\/$/, '');
  return trimmed.endsWith('/_bulk') ? trimmed : `${trimmed}/_bulk`;
}

function resolveEndpoint(value?: string): string {
  const config = resolveEnvironment();
  return value ?? config.env?.opensearch?.url ?? DEFAULT_OPENSEARCH_URL;
}

function buildAuthConfig() {
  const config = resolveEnvironment();
  const username = config.env?.opensearch?.user ?? DEFAULT_OPENSEARCH_USER;
  const password = config.env?.opensearch?.password ?? DEFAULT_OPENSEARCH_PASSWORD;

  if (!username && !password) {
    return {};
  }

  return {
    auth: {
      username: username ?? '',
      password: password ?? ''
    }
  };
}

function buildBulkPayload(
  docs: unknown[] | Record<string, unknown>,
  index?: string
): { payload: string; count: number } {
  if (!index) {
    throw new Error('Missing required --index for JSON/YAML inputs.');
  }

  const list = Array.isArray(docs) ? docs : [docs];
  const lines: string[] = [];

  for (const item of list) {
    if (!item || typeof item !== 'object') {
      throw new Error('Each document must be an object.');
    }
    lines.push(JSON.stringify({ index: { _index: index } }));
    lines.push(JSON.stringify(item));
  }

  return { payload: `${lines.join('\n')}\n`, count: list.length };
}

function isBulkMeta(doc: unknown): doc is Record<string, Record<string, unknown>> {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return false;
  }
  const keys = Object.keys(doc as Record<string, unknown>);
  if (keys.length !== 1) {
    return false;
  }
  const key = keys[0];
  return key === 'index' || key === 'create' || key === 'update' || key === 'delete';
}

function normalizeBulkPayload(
  raw: string,
  options: { dynamicIds?: boolean; dynamicTimestamps?: boolean; indexOverride?: string }
): string {
  const lines = raw.split('\n');
  const output: string[] = [];
  let payloadIndex = 0;
  const baseDate = new Date();

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    try {
      const doc = JSON.parse(line) as unknown;
      if (isBulkMeta(doc)) {
        const action = Object.keys(doc)[0];
        const meta = { ...(doc as Record<string, any>)[action] };
        if (options.dynamicIds && meta && typeof meta === 'object') {
          delete meta._id;
        }
        if (options.indexOverride && meta && typeof meta === 'object') {
          meta._index = options.indexOverride;
        }
        output.push(JSON.stringify({ [action]: meta }));
      } else {
        if (options.dynamicTimestamps && doc && typeof doc === 'object') {
          const current = new Date(baseDate.getTime() + payloadIndex * 1000);
          const timestamp = current.toISOString().replace(/\.\d{3}Z$/, 'Z');
          (doc as Record<string, unknown>).createdAt = timestamp;
          (doc as Record<string, unknown>).updatedAt = timestamp;
          payloadIndex += 1;
        }
        output.push(JSON.stringify(doc));
      }
    } catch (error) {
      output.push(line);
    }
  }

  return `${output.join('\n')}\n`;
}

async function waitForOpenSearch(endpoint: string, seconds: number): Promise<void> {
  const start = Date.now();
  const timeoutMs = seconds * 1000;

  while (Date.now() - start < timeoutMs) {
    try {
      await axios.get(endpoint, buildAuthConfig());
      return;
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  throw new Error(`OpenSearch did not respond within ${seconds}s at ${endpoint}`);
}

async function ensureOperationsIndex(
  endpoint: string,
  index: string,
  reset: boolean
): Promise<void> {
  const base = endpoint.replace(/\/$/, '');
  const indexUrl = `${base}/${encodeURIComponent(index)}`;

  let exists = true;
  try {
    await axios.head(indexUrl, buildAuthConfig());
  } catch (error: any) {
    if (error?.response?.status === 404) {
      exists = false;
    } else {
      throw error;
    }
  }

  if (reset && exists) {
    await axios.delete(indexUrl, buildAuthConfig());
    exists = false;
  }

  if (exists) {
    return;
  }

  const body = {
    settings: {
      number_of_shards: 1,
      number_of_replicas: 0
    },
    mappings: {
      properties: {
        operationId: { type: 'keyword' },
        operationType: { type: 'keyword' },
        status: { type: 'keyword' },
        amount: { type: 'long' },
        currency: { type: 'keyword' },
        accountId: { type: 'keyword' },
        chain: { type: 'keyword' },
        origin: { type: 'keyword' },
        metadata: { type: 'object', enabled: true },
        createdAt: { type: 'date' },
        updatedAt: { type: 'date' }
      }
    }
  };

  await axios.put(indexUrl, body, {
    headers: { 'content-type': 'application/json' },
    ...buildAuthConfig()
  });
}

async function loadStructuredFile(filePath: string): Promise<unknown> {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const ext = path.extname(absolutePath).toLowerCase();
  const raw = await fs.readFile(absolutePath, 'utf-8');

  if (ext === '.json') {
    return JSON.parse(raw) as unknown;
  }

  if (YAML_EXTENSIONS.has(ext)) {
    return YAML.parse(raw) as unknown;
  }

  throw new Error('Unsupported file type. Use .json, .yaml, or .yml.');
}

async function loadFileContent(filePath: string, options: OpensearchLoadOptions) {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const ext = path.extname(absolutePath).toLowerCase();
  const raw = await fs.readFile(absolutePath, 'utf-8');

  if (NDJSON_EXTENSIONS.has(ext)) {
    const payload = raw.endsWith('\n') ? raw : `${raw}\n`;
    const count = payload.split('\n').filter(line => line.trim().length > 0).length / 2;
    return { payload, count };
  }

  if (ext === '.json') {
    const parsed = JSON.parse(raw) as unknown;
    return buildBulkPayload(parsed as any, options.index);
  }

  if (YAML_EXTENSIONS.has(ext)) {
    const parsed = YAML.parse(raw) as unknown;
    return buildBulkPayload(parsed as any, options.index);
  }

  throw new Error('Unsupported file type. Use .ndjson, .jsonl, .json, .yaml, or .yml.');
}

export function registerOpensearchCommand(program: Command): void {
  const opensearch = program
    .command('opensearch')
    .description('Manage OpenSearch data and indexes');

  opensearch
    .command('load <file>')
    .description('Load a file into OpenSearch (_bulk).')
    .option('-e, --endpoint <url>', 'OpenSearch base URL', DEFAULT_OPENSEARCH_URL)
    .option('-i, --index <name>', 'Target index for JSON/YAML inputs')
    .option('--dry-run', 'Preview the bulk payload without sending it', false)
    .action(async (file: string, options: OpensearchLoadOptions) => {
      try {
        const { payload, count } = await loadFileContent(file, options);
        if (options.dryRun) {
          console.info(`Bulk payload ready (${count} docs).`);
          console.info(payload);
          return;
        }

        const endpoint = normalizeBulkEndpoint(resolveEndpoint(options.endpoint));
        const response = await axios.post(endpoint, payload, {
          headers: { 'content-type': 'application/x-ndjson' },
          ...buildAuthConfig()
        });

        console.info(`Loaded ${count} document(s) into OpenSearch.`);
        console.table(response.data);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error while loading OpenSearch file: ${message}`);
        process.exitCode = 1;
      }
    });

  opensearch
    .command('create-index <name>')
    .description('Create an OpenSearch index.')
    .option('-e, --endpoint <url>', 'OpenSearch base URL', DEFAULT_OPENSEARCH_URL)
    .option('-b, --body <file>', 'JSON/YAML file with index settings/mappings')
    .action(async (name: string, options: OpensearchCreateIndexOptions) => {
      try {
        const base = resolveEndpoint(options.endpoint).replace(/\/$/, '');
        const url = `${base}/${encodeURIComponent(name)}`;
        const body = options.body ? await loadStructuredFile(options.body) : {};

        const response = await axios.put(url, body, {
          headers: { 'content-type': 'application/json' },
          ...buildAuthConfig()
        });

        console.info(`Index "${name}" created.`);
        console.table(response.data);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error while creating OpenSearch index: ${message}`);
        process.exitCode = 1;
      }
    });

  opensearch
    .command('seed-operations')
    .description('Seed the operations index with demo data.')
    .option('-e, --endpoint <url>', 'OpenSearch base URL', DEFAULT_OPENSEARCH_URL)
    .option('-i, --index <name>', 'Target index name', 'operations')
    .option(
      '-f, --bulk-file <path>',
      'NDJSON bulk file to load',
      DEFAULT_OPERATIONS_BULK
    )
    .option('--wait-seconds <number>', 'Seconds to wait for OpenSearch', value => Number(value), 120)
    .option('--reset', 'Delete the index before loading', false)
    .option('--dynamic-ids', 'Remove _id so OpenSearch generates new ids', false)
    .option('--dynamic-timestamps', 'Overwrite createdAt/updatedAt with current timestamps', false)
    .action(async (options: OpensearchSeedOperationsOptions) => {
      try {
        const endpoint = resolveEndpoint(options.endpoint);
        const index = options.index ?? 'operations';
        const bulkFile = options.bulkFile ?? DEFAULT_OPERATIONS_BULK;
        const waitSeconds = Number(options.waitSeconds ?? 120);
        const reset = options.reset ?? false;
        const dynamicIds = options.dynamicIds ?? false;
        const dynamicTimestamps = options.dynamicTimestamps ?? false;

        await waitForOpenSearch(endpoint, waitSeconds);
        await ensureOperationsIndex(endpoint, index, reset);

        const raw = await fs.readFile(
          path.isAbsolute(bulkFile) ? bulkFile : path.resolve(process.cwd(), bulkFile),
          'utf-8'
        );
        const payload = normalizeBulkPayload(raw, {
          dynamicIds,
          dynamicTimestamps,
          indexOverride: index
        });

        const bulkEndpoint = normalizeBulkEndpoint(endpoint);
        const response = await axios.post(bulkEndpoint, payload, {
          headers: { 'content-type': 'application/x-ndjson' },
          ...buildAuthConfig()
        });

        console.info(`Seeded OpenSearch index "${index}".`);
        console.table(response.data);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error while seeding OpenSearch operations: ${message}`);
        process.exitCode = 1;
      }
    });

  opensearch
    .command('insert <index> <file>')
    .description('Insert a single document into an OpenSearch index.')
    .option('-e, --endpoint <url>', 'OpenSearch base URL', DEFAULT_OPENSEARCH_URL)
    .option('--id <value>', 'Document id (optional)')
    .action(async (index: string, file: string, options: OpensearchInsertOptions) => {
      try {
        const doc = await loadStructuredFile(file);
        if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
          throw new Error('Document must be a JSON/YAML object.');
        }

        const base = resolveEndpoint(options.endpoint).replace(/\/$/, '');
        const docPath = options.id ? `/_doc/${encodeURIComponent(options.id)}` : '/_doc';
        const url = `${base}/${encodeURIComponent(index)}${docPath}`;
        const method = options.id ? axios.put : axios.post;
        const response = await method(url, doc, {
          headers: { 'content-type': 'application/json' },
          ...buildAuthConfig()
        });

        console.info(`Inserted document into "${index}".`);
        console.table(response.data);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error while inserting OpenSearch document: ${message}`);
        process.exitCode = 1;
      }
    });

  opensearch
    .command('describe-index <name>')
    .description('Fetch index structure (mappings/settings).')
    .option('-e, --endpoint <url>', 'OpenSearch base URL', DEFAULT_OPENSEARCH_URL)
    .option('--mappings', 'Fetch mappings only', false)
    .option('--settings', 'Fetch settings only', false)
    .option('--unwrap', 'Output only the mappings/settings object', false)
    .option('--table', 'Display mappings as a table', false)
    .option(
      '-f, --format <format>',
      'Output format: pretty or compact',
      (value: string) => (value === 'compact' ? 'compact' : 'pretty'),
      'pretty'
    )
    .action(async (name: string, options: OpensearchDescribeIndexOptions) => {
      try {
        const base = resolveEndpoint(options.endpoint).replace(/\/$/, '');
        const indexName = encodeURIComponent(name);
        const fetchMappings = options.mappings || (!options.mappings && !options.settings);
        const fetchSettings = options.settings || (!options.mappings && !options.settings);

        const requests: Array<Promise<{ kind: string; data: unknown }>> = [];
        if (fetchMappings) {
          requests.push(
            axios
              .get(`${base}/${indexName}/_mapping`, buildAuthConfig())
              .then(response => ({ kind: 'mappings', data: response.data }))
          );
        }
        if (fetchSettings) {
          requests.push(
            axios
              .get(`${base}/${indexName}/_settings`, buildAuthConfig())
              .then(response => ({ kind: 'settings', data: response.data }))
          );
        }

        const results = await Promise.all(requests);
        for (const result of results) {
          const payload = options.unwrap
            ? (result.data as Record<string, any>)[name]?.[result.kind]
            : result.data;
          console.info(`Index "${name}" ${result.kind}:`);
          if (options.table && result.kind === 'mappings') {
            const properties = options.unwrap
              ? (payload as Record<string, any>)?.properties
              : (result.data as Record<string, any>)[name]?.mappings?.properties;
            if (!properties || typeof properties !== 'object') {
              console.info('No mappings properties found to display.');
              continue;
            }

            const rows = Object.entries(properties).map(([field, definition]) => {
              const def = definition as Record<string, any>;
              const keyword = def.fields?.keyword?.type ? 'keyword' : '';
              return {
                field,
                type: def.type ?? '',
                keyword
              };
            });
            console.table(rows);
            continue;
          }

          const output =
            options.format === 'compact'
              ? JSON.stringify(payload)
              : JSON.stringify(payload, null, 2);
          console.info(output);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error while describing OpenSearch index: ${message}`);
        process.exitCode = 1;
      }
    });

  opensearch
    .command('list-indices')
    .description('List all OpenSearch indices.')
    .option('-e, --endpoint <url>', 'OpenSearch base URL', DEFAULT_OPENSEARCH_URL)
    .option(
      '-f, --format <format>',
      'Output format: json or table',
      (value: string) => (value === 'json' || value === 'table' ? value : 'table'),
      'table'
    )
    .action(async (options: OpensearchListIndicesOptions) => {
      try {
        const base = resolveEndpoint(options.endpoint).replace(/\/$/, '');
        const response = await axios.get(`${base}/_cat/indices?format=json`, buildAuthConfig());
        if (options.format === 'json') {
          console.info(JSON.stringify(response.data, null, 2));
        } else {
          console.table(response.data);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error while listing OpenSearch indices: ${message}`);
        process.exitCode = 1;
      }
    });

  opensearch
    .command('search <index>')
    .description('Query an OpenSearch index.')
    .option('-e, --endpoint <url>', 'OpenSearch base URL', DEFAULT_OPENSEARCH_URL)
    .option('-f, --file <path>', 'JSON/YAML file with the full _search body')
    .option('-q, --q <query>', 'Query string for query_string search')
    .option('--size <number>', 'Number of results to return', value => Number(value))
    .option('--from <number>', 'Result offset', value => Number(value))
    .option('--table', 'Display hits as a table', false)
    .option(
      '--fields <list>',
      'Comma-separated _source fields for table output',
      'id,name,type,status'
    )
    .action(async (index: string, options: OpensearchSearchOptions) => {
      try {
        const base = resolveEndpoint(options.endpoint).replace(/\/$/, '');
        const url = `${base}/${encodeURIComponent(index)}/_search`;

        let body: Record<string, unknown>;
        if (options.file) {
          const parsed = await loadStructuredFile(options.file);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Search body must be a JSON/YAML object.');
          }
          body = parsed as Record<string, unknown>;
        } else if (options.q) {
          body = { query: { query_string: { query: options.q } } };
        } else {
          body = { query: { match_all: {} } };
        }

        if (typeof options.size === 'number' && !Number.isNaN(options.size)) {
          body.size = options.size;
        }
        if (typeof options.from === 'number' && !Number.isNaN(options.from)) {
          body.from = options.from;
        }

        const response = await axios.post(url, body, {
          headers: { 'content-type': 'application/json' },
          ...buildAuthConfig()
        });

        if (options.table) {
          const hits = (response.data as any)?.hits?.hits ?? [];
          const fields = options.fields
            ? options.fields.split(',').map(item => item.trim()).filter(Boolean)
            : ['id', 'name', 'type', 'status'];
          const rows = hits.map((hit: any) => {
            const source = hit?._source ?? {};
            const row: Record<string, unknown> = { _id: hit?._id ?? '' };
            for (const field of fields) {
              row[field] = source[field];
            }
            return row;
          });
          console.table(rows);
        } else {
          console.info(JSON.stringify(response.data, null, 2));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error while querying OpenSearch index: ${message}`);
        process.exitCode = 1;
      }
    });

  opensearch
    .command('delete <index> <id>')
    .description('Delete a document by id from an OpenSearch index.')
    .option('-e, --endpoint <url>', 'OpenSearch base URL', DEFAULT_OPENSEARCH_URL)
    .option('-y, --yes', 'Skip confirmation prompt', false)
    .action(async (index: string, id: string, options: OpensearchDeleteOptions) => {
      try {
        if (!options.yes) {
          const ok = await confirmAction(`Delete document "${id}" from "${index}"?`);
          if (!ok) {
            console.info('Aborted.');
            return;
          }
        }
        const base = resolveEndpoint(options.endpoint).replace(/\/$/, '');
        const url = `${base}/${encodeURIComponent(index)}/_doc/${encodeURIComponent(id)}`;
        const response = await axios.delete(url, buildAuthConfig());
        console.info(`Deleted document "${id}" from "${index}".`);
        console.table(response.data);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error while deleting OpenSearch document: ${message}`);
        process.exitCode = 1;
      }
    });

  opensearch
    .command('delete-all <index>')
    .description('Delete all documents from an OpenSearch index (delete by query).')
    .option('-e, --endpoint <url>', 'OpenSearch base URL', DEFAULT_OPENSEARCH_URL)
    .option('-y, --yes', 'Skip confirmation prompt', false)
    .action(async (index: string, options: OpensearchDeleteOptions) => {
      try {
        if (!options.yes) {
          const ok = await confirmAction(
            `Delete ALL documents from "${index}"? This cannot be undone.`
          );
          if (!ok) {
            console.info('Aborted.');
            return;
          }
        }
        const base = resolveEndpoint(options.endpoint).replace(/\/$/, '');
        const url = `${base}/${encodeURIComponent(index)}/_delete_by_query`;
        const response = await axios.post(
          url,
          { query: { match_all: {} } },
          {
            headers: { 'content-type': 'application/json' },
            ...buildAuthConfig()
          }
        );
        console.info(`Deleted all documents from "${index}".`);
        console.table(response.data);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error while deleting OpenSearch documents: ${message}`);
        process.exitCode = 1;
      }
    });

  opensearch
    .command('export-index <name>')
    .description('Export index mappings/settings as JSON or YAML.')
    .option('-e, --endpoint <url>', 'OpenSearch base URL', DEFAULT_OPENSEARCH_URL)
    .option('--mappings', 'Export mappings only', false)
    .option('--settings', 'Export settings only', false)
    .option(
      '-f, --format <format>',
      'Output format: json or yaml',
      (value: string) => (value === 'yaml' ? 'yaml' : 'json'),
      'json'
    )
    .option('-o, --output <file>', 'Write output to a file instead of stdout')
    .action(async (name: string, options: OpensearchExportOptions) => {
      try {
        const base = resolveEndpoint(options.endpoint).replace(/\/$/, '');
        const indexName = encodeURIComponent(name);
        const fetchMappings = options.mappings || (!options.mappings && !options.settings);
        const fetchSettings = options.settings || (!options.mappings && !options.settings);

        const output: Record<string, unknown> = {};

        if (fetchMappings) {
          const response = await axios.get(`${base}/${indexName}/_mapping`, buildAuthConfig());
          const mappings = (response.data as Record<string, any>)[name]?.mappings ?? {};
          output.mappings = mappings;
        }

        if (fetchSettings) {
          const response = await axios.get(`${base}/${indexName}/_settings`, buildAuthConfig());
          const settings = (response.data as Record<string, any>)[name]?.settings ?? {};
          output.settings = settings;
        }

        const content =
          options.format === 'yaml' ? YAML.stringify(output) : JSON.stringify(output, null, 2);

        if (options.output) {
          const absolutePath = path.isAbsolute(options.output)
            ? options.output
            : path.resolve(process.cwd(), options.output);
          await fs.writeFile(absolutePath, content, 'utf-8');
          console.info(`Exported index "${name}" to ${absolutePath}.`);
        } else {
          console.info(content);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error while exporting OpenSearch index: ${message}`);
        process.exitCode = 1;
      }
    });
}
