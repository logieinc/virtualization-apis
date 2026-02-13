import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

import { resolveEnvironment } from '../config';

type PostgresBaseOptions = {
  service?: string;
  user?: string;
  composeDir?: string;
  target?: string;
};

type PostgresCreateDbOptions = PostgresBaseOptions & {
  adminDb?: string;
  drop?: boolean;
  yes?: boolean;
  schemaDir?: string;
  schemaFile?: string;
};

type PostgresDropDbOptions = PostgresBaseOptions & {
  adminDb?: string;
  yes?: boolean;
};

type PostgresSeedOptions = PostgresBaseOptions & {
  db?: string;
};

type PostgresSeedGenericOptions = PostgresSeedOptions & {
  sqlFile?: string;
  sqlDir?: string;
};

type PostgresSeedYamlOptions = PostgresSeedOptions & {
  seed: string;
};
const DEFAULT_SERVICE = process.env.POSTGRES_SERVICE || 'postgres';
const DEFAULT_USER = process.env.POSTGRES_USER || 'postgres';
const DEFAULT_ADMIN_DB = process.env.POSTGRES_ADMIN_DB || 'postgres';
const DEFAULT_COMPOSE_DIR =
  process.env.COMPOSE_DIR || path.resolve(__dirname, '..', '..', '..');

const SEEDS_ROOT = path.resolve(__dirname, '..', '..', 'resources', 'napa', 'seeds');
const POSTGRES_SEEDS_ROOT = path.join(SEEDS_ROOT, 'postgres');

function resolveSeedPath(...segments: string[]): string {
  return path.join(POSTGRES_SEEDS_ROOT, ...segments);
}

type PostgresRuntime = {
  mode: 'compose' | 'direct';
  service: string;
  user: string;
  password?: string;
  host?: string;
  port?: number;
  adminDb: string;
  composeDir: string;
  ssl?: boolean;
};

function resolvePostgresRuntime(
  options: PostgresBaseOptions & { adminDb?: string; target?: string },
  fallbackTarget?: string
): PostgresRuntime {
  const config = resolveEnvironment();
  const cfg = config.env?.postgres;
  const targetName = options.target ?? fallbackTarget;
  const dbTarget = targetName ? config.env?.databases?.[targetName] : undefined;

  const mode =
    dbTarget?.mode ??
    cfg?.mode ??
    (process.env.PG_MODE as 'compose' | 'direct' | undefined) ??
    (process.env.POSTGRES_MODE as 'compose' | 'direct' | undefined) ??
    'compose';

  const service =
    options.service ?? dbTarget?.service ?? cfg?.service ?? process.env.POSTGRES_SERVICE ?? 'postgres';
  const user = options.user ?? dbTarget?.user ?? cfg?.user ?? process.env.POSTGRES_USER ?? 'postgres';
  const password =
    dbTarget?.password ??
    cfg?.password ??
    process.env.POSTGRES_PASSWORD ??
    process.env.PG_PASSWORD;
  const host = dbTarget?.host ?? cfg?.host ?? process.env.POSTGRES_HOST ?? process.env.PG_HOST;
  const port =
    dbTarget?.port ??
    cfg?.port ??
    (process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : undefined) ??
    (process.env.PG_PORT ? Number(process.env.PG_PORT) : undefined) ??
    5432;
  const adminDb =
    options.adminDb ??
    dbTarget?.adminDb ??
    cfg?.adminDb ??
    process.env.POSTGRES_ADMIN_DB ??
    'postgres';
  const composeDir = options.composeDir ?? dbTarget?.composeDir ?? cfg?.composeDir ?? DEFAULT_COMPOSE_DIR;
  const ssl =
    dbTarget?.ssl ??
    cfg?.ssl ??
    (process.env.POSTGRES_SSL ? process.env.POSTGRES_SSL.toLowerCase() === 'true' : undefined);

  return {
    mode: mode === 'direct' ? 'direct' : 'compose',
    service,
    user,
    password,
    host,
    port,
    adminDb,
    composeDir,
    ssl
  };
}

async function runCommand(
  command: string,
  args: string[],
  {
    cwd,
    env,
    input,
    capture
  }: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; capture?: boolean }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: [input ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit']
    });

    let stdout = '';
    let stderr = '';
    if (capture && child.stdout) {
      child.stdout.on('data', chunk => {
        stdout += String(chunk);
      });
    }
    if (capture && child.stderr) {
      child.stderr.on('data', chunk => {
        stderr += String(chunk);
      });
    }

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const details = stderr.trim();
      const suffix = details ? `: ${details}` : '';
      reject(new Error(`Command failed (${command} ${args.join(' ')})${suffix}`));
    });

    if (input && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

async function runCommandCapture(
  command: string,
  args: string[],
  { cwd, env, input }: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: [input ? 'pipe' : 'inherit', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    if (child.stdout) {
      child.stdout.on('data', chunk => {
        stdout += String(chunk);
      });
    }
    if (child.stderr) {
      child.stderr.on('data', chunk => {
        stderr += String(chunk);
      });
    }

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const details = stderr.trim();
      const suffix = details ? `: ${details}` : '';
      reject(new Error(`Command failed (${command} ${args.join(' ')})${suffix}`));
    });

    if (input && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

async function runDockerCompose(
  args: string[],
  options: { cwd: string; input?: string; capture?: boolean }
): Promise<string> {
  return runCommand('docker', ['compose', ...args], {
    cwd: options.cwd,
    input: options.input,
    capture: options.capture
  });
}

async function waitForPostgresCompose(
  service: string,
  user: string,
  adminDb: string,
  composeDir: string,
  attempts = 30,
  sleepSeconds = 2
): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      await runDockerCompose(
        ['exec', '-T', service, 'pg_isready', '-U', user, '-d', adminDb],
        { cwd: composeDir }
      );
      return;
    } catch (error) {
      if (i === attempts - 1) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, sleepSeconds * 1000));
    }
  }
}

async function waitForPostgresDirect(
  host: string,
  port: number,
  user: string,
  password: string | undefined,
  adminDb: string,
  ssl: boolean | undefined,
  attempts = 30,
  sleepSeconds = 2
): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      await runPsqlDirect(host, port, user, password, adminDb, ssl, 'select 1;');
      return;
    } catch (error) {
      if (i === attempts - 1) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, sleepSeconds * 1000));
    }
  }
}

async function databaseExistsCompose(
  service: string,
  user: string,
  adminDb: string,
  composeDir: string,
  name: string
): Promise<boolean> {
  const output = await runDockerCompose(
    [
      'exec',
      '-T',
      service,
      'psql',
      '-U',
      user,
      '-d',
      adminDb,
      '-t',
      '-c',
      `SELECT 1 FROM pg_database WHERE datname='${name}';`
    ],
    { cwd: composeDir, capture: true }
  );
  return output.trim().startsWith('1');
}

async function databaseExistsDirect(
  host: string,
  port: number,
  user: string,
  password: string | undefined,
  adminDb: string,
  ssl: boolean | undefined,
  name: string
): Promise<boolean> {
  const output = await runPsqlDirect(
    host,
    port,
    user,
    password,
    adminDb,
    ssl,
    `SELECT 1 FROM pg_database WHERE datname='${name}';`
  );
  return output.trim().startsWith('1');
}

async function createDatabaseCompose(
  service: string,
  user: string,
  adminDb: string,
  composeDir: string,
  name: string
): Promise<void> {
  await runDockerCompose(
    ['exec', '-T', service, 'psql', '-U', user, '-d', adminDb, '-c', `CREATE DATABASE "${name}";`],
    { cwd: composeDir }
  );
}

async function createDatabaseDirect(
  host: string,
  port: number,
  user: string,
  password: string | undefined,
  adminDb: string,
  ssl: boolean | undefined,
  name: string
): Promise<void> {
  await runPsqlDirect(
    host,
    port,
    user,
    password,
    adminDb,
    ssl,
    `CREATE DATABASE "${name}";`
  );
}

async function dropDatabaseCompose(
  service: string,
  user: string,
  adminDb: string,
  composeDir: string,
  name: string
): Promise<void> {
  await runDockerCompose(
    ['exec', '-T', service, 'psql', '-U', user, '-d', adminDb, '-c', `DROP DATABASE "${name}";`],
    { cwd: composeDir }
  );
}

async function dropDatabaseDirect(
  host: string,
  port: number,
  user: string,
  password: string | undefined,
  adminDb: string,
  ssl: boolean | undefined,
  name: string
): Promise<void> {
  await runPsqlDirect(
    host,
    port,
    user,
    password,
    adminDb,
    ssl,
    `DROP DATABASE "${name}";`
  );
}

async function runPsqlCompose(
  service: string,
  user: string,
  db: string,
  composeDir: string,
  sql: string
): Promise<void> {
  await runDockerCompose(
    ['exec', '-T', service, 'psql', '-U', user, '-d', db, '-f', '/dev/stdin'],
    { cwd: composeDir, input: sql }
  );
}

async function runPsqlDirect(
  host: string,
  port: number,
  user: string,
  password: string | undefined,
  db: string,
  ssl: boolean | undefined,
  sql: string
): Promise<string> {
  const args = ['-h', host, '-p', String(port), '-U', user, '-d', db, '-t', '-c', sql];
  return runCommand('psql', args, {
    env: {
      ...process.env,
      PGPASSWORD: password ?? process.env.PGPASSWORD ?? '',
      PGSSLMODE: ssl ? 'require' : process.env.PGSSLMODE ?? ''
    },
    capture: true
  });
}

async function runPsqlWithRuntime(runtime: PostgresRuntime, db: string, sql: string): Promise<void> {
  if (runtime.mode === 'direct') {
    if (!runtime.host) {
      throw new Error('Missing Postgres host for direct mode.');
    }
    await runPsqlDirect(
      runtime.host,
      runtime.port ?? 5432,
      runtime.user,
      runtime.password,
      db,
      runtime.ssl,
      sql
    );
    return;
  }
  await runPsqlCompose(runtime.service, runtime.user, db, runtime.composeDir, sql);
}

async function runPsqlWithRuntimeCapture(
  runtime: PostgresRuntime,
  db: string,
  sql: string
): Promise<string> {
  if (runtime.mode === 'direct') {
    if (!runtime.host) {
      throw new Error('Missing Postgres host for direct mode.');
    }
    return runPsqlDirect(
      runtime.host,
      runtime.port ?? 5432,
      runtime.user,
      runtime.password,
      db,
      runtime.ssl,
      sql
    );
  }

  return runDockerCompose(
    ['exec', '-T', runtime.service, 'psql', '-U', runtime.user, '-d', db, '-t', '-A', '-c', sql],
    { cwd: runtime.composeDir, capture: true }
  );
}

async function applySchemaFiles(
  runtime: PostgresRuntime,
  db: string,
  schemaDir?: string,
  schemaFile?: string
): Promise<void> {
  if (schemaFile) {
    const absolute = path.isAbsolute(schemaFile)
      ? schemaFile
      : path.resolve(process.cwd(), schemaFile);
    await applySchemaFromFile(runtime, db, absolute);
    return;
  }

  if (!schemaDir) {
    return;
  }

  const dir = path.isAbsolute(schemaDir) ? schemaDir : path.resolve(process.cwd(), schemaDir);
  const entries = await fs.readdir(dir);
  const schemaFiles = entries
    .filter(name => {
      const lower = name.toLowerCase();
      return lower.endsWith('.sql') || lower.endsWith('.prisma');
    })
    .sort();

  if (schemaFiles.length === 0) {
    console.info(`No .sql or .prisma files found in ${dir}.`);
    return;
  }

  for (const file of schemaFiles) {
    const fullPath = path.join(dir, file);
    await applySchemaFromFile(runtime, db, fullPath);
  }
}

async function applySchemaFromFile(
  runtime: PostgresRuntime,
  db: string,
  absolutePath: string
): Promise<void> {
  if (absolutePath.toLowerCase().endsWith('.prisma')) {
    console.info(`Generating SQL from Prisma schema ${absolutePath}...`);
    const prismaInfo = await resolvePrismaSchemaInfo(absolutePath, runtime, db);
    try {
      const sql = await generateSqlFromPrismaSchema(absolutePath, prismaInfo);
      if (!sql.trim()) {
        console.info('No SQL generated from Prisma schema. Nothing to apply.');
        return;
      }
      if (prismaInfo.user && prismaInfo.user !== runtime.user && prismaInfo.password) {
        await ensureRoleAndGrant(runtime, db, prismaInfo.user, prismaInfo.password);
      }
      console.info('Applying generated schema...');
      await runPsqlWithRuntime(runtime, db, sql);
      console.info('Schema applied.');
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('Prisma diff produced no SQL output')) {
        console.info('Falling back to Prisma db push...');
        if (prismaInfo.user && prismaInfo.user !== runtime.user && prismaInfo.password) {
          await ensureRoleAndGrant(runtime, db, prismaInfo.user, prismaInfo.password);
        }
        await runPrismaDbPush(absolutePath, prismaInfo);
        console.info('Schema applied via Prisma db push.');
        return;
      }
      throw error;
    }
  }

  console.info(`Applying schema file ${absolutePath}...`);
  const sql = await fs.readFile(absolutePath, 'utf-8');
  await runPsqlWithRuntime(runtime, db, sql);
  console.info('Schema applied.');
}

type SeedTable = {
  action?: 'insert' | 'upsert';
  upsertBy?: string[];
  rows?: Record<string, unknown>[];
};

type SeedOperation = {
  type: 'insert' | 'upsert' | 'update' | 'delete';
  table: string;
  rows?: Record<string, unknown>[];
  upsertBy?: string[];
  where?: Record<string, unknown>;
  set?: Record<string, unknown>;
};

type SeedDatabase = {
  db?: string;
  target?: string;
  variables?: Record<string, unknown>;
  tables?: Record<string, SeedTable>;
  operations?: SeedOperation[];
};

type SeedYaml = {
  variables?: Record<string, unknown>;
  tables?: Record<string, SeedTable>;
  operations?: SeedOperation[];
  databases?: Record<string, SeedDatabase>;
};

type SeedRef = {
  ref: {
    table: string;
    where: Record<string, unknown>;
    column?: string;
  };
};

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function toSqlValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Invalid number value in seed YAML.');
    }
    return String(value);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (value instanceof Date) {
    return `'${value.toISOString().replace(/'/g, "''")}'`;
  }
  if (typeof value === 'object') {
    const raw = value as { sql?: unknown };
    if (
      raw &&
      typeof raw === 'object' &&
      Object.keys(raw).length === 1 &&
      typeof raw.sql === 'string'
    ) {
      return raw.sql;
    }
    const json = JSON.stringify(value);
    return `'${json.replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildInsertSql(table: string, row: Record<string, unknown>, upsertBy?: string[]): string {
  const columns = Object.keys(row);
  if (columns.length === 0) {
    throw new Error(`Seed row for table "${table}" has no columns.`);
  }
  const columnSql = columns.map(quoteIdentifier).join(', ');
  const valuesSql = columns.map(col => toSqlValue(row[col])).join(', ');
  let sql = `INSERT INTO ${quoteIdentifier(table)} (${columnSql}) VALUES (${valuesSql})`;

  if (!upsertBy || upsertBy.length === 0) {
    return `${sql};`;
  }

  const conflictCols = upsertBy.map(quoteIdentifier).join(', ');
  const updateCols = columns.filter(col => !upsertBy.includes(col));
  if (updateCols.length === 0) {
    return `${sql} ON CONFLICT (${conflictCols}) DO NOTHING;`;
  }
  const updateSql = updateCols
    .map(col => `${quoteIdentifier(col)} = EXCLUDED.${quoteIdentifier(col)}`)
    .join(', ');
  return `${sql} ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateSql};`;
}

function buildWhereSql(table: string, where: Record<string, unknown>): string {
  const entries = Object.entries(where);
  if (entries.length === 0) {
    throw new Error(`Operation on table "${table}" requires a non-empty "where" clause.`);
  }
  const predicates = entries.map(([field, value]) => {
    if (value === null) {
      return `${quoteIdentifier(field)} IS NULL`;
    }
    return `${quoteIdentifier(field)} = ${toSqlValue(value)}`;
  });
  return predicates.join(' AND ');
}

function buildUpdateSql(
  table: string,
  set: Record<string, unknown>,
  where: Record<string, unknown>
): string {
  const setEntries = Object.entries(set);
  if (setEntries.length === 0) {
    throw new Error(`Update operation for "${table}" requires a non-empty "set" object.`);
  }
  const setSql = setEntries.map(([col, value]) => `${quoteIdentifier(col)} = ${toSqlValue(value)}`).join(', ');
  const whereSql = buildWhereSql(table, where);
  return `UPDATE ${quoteIdentifier(table)} SET ${setSql} WHERE ${whereSql};`;
}

function buildDeleteSql(table: string, where: Record<string, unknown>): string {
  const whereSql = buildWhereSql(table, where);
  return `DELETE FROM ${quoteIdentifier(table)} WHERE ${whereSql};`;
}

function resolveVarByPath(variables: Record<string, unknown>, keyPath: string): unknown {
  return keyPath.split('.').reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== 'object') {
      return undefined;
    }
    return (acc as Record<string, unknown>)[key];
  }, variables);
}

function applySeedVariables(value: unknown, variables: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const exactHandlebars = value.match(/^{{\s*vars\.([a-zA-Z0-9_.-]+)\s*}}$/);
    if (exactHandlebars) {
      const resolved = resolveVarByPath(variables, exactHandlebars[1]);
      return resolved !== undefined ? resolved : '';
    }
    const exactLegacy = value.match(/^\$\{([a-zA-Z0-9_.-]+)\}$/);
    if (exactLegacy) {
      const resolved = resolveVarByPath(variables, exactLegacy[1]);
      return resolved !== undefined ? resolved : '';
    }
    return value
      .replace(/{{\s*vars\.([a-zA-Z0-9_.-]+)\s*}}/g, (_match, token) => {
        const resolved = resolveVarByPath(variables, token);
        return resolved !== undefined ? String(resolved) : '';
      })
      .replace(/\$\{([a-zA-Z0-9_.-]+)\}/g, (_match, token) => {
        const resolved = resolveVarByPath(variables, token);
        return resolved !== undefined ? String(resolved) : '';
      });
  }

  if (Array.isArray(value)) {
    return value.map(item => applySeedVariables(item, variables));
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = applySeedVariables(item, variables);
    }
    return result;
  }

  return value;
}

async function applyTableSeeds(
  runtime: PostgresRuntime,
  db: string,
  tables: Record<string, SeedTable>
): Promise<void> {
  for (const [table, config] of Object.entries(tables)) {
    const rows = config?.rows ?? [];
    if (!rows.length) {
      continue;
    }
    const action = config?.action ?? (config?.upsertBy?.length ? 'upsert' : 'insert');
    if (!['insert', 'upsert'].includes(action)) {
      throw new Error(`Invalid table action "${action}" in table "${table}". Use insert or upsert.`);
    }
    const upsertBy = action === 'upsert' ? config?.upsertBy ?? [] : [];
    console.info(
      `Seeding ${rows.length} row(s) into ${table}${upsertBy.length ? ` (upsert by ${upsertBy.join(', ')})` : ''}...`
    );
    for (const row of rows) {
      const resolvedRow = await resolveSeedRow(runtime, db, row);
      const sql = buildInsertSql(table, resolvedRow, upsertBy);
      await runPsqlWithRuntime(runtime, db, sql);
    }
  }
}

async function applySeedOperations(
  runtime: PostgresRuntime,
  db: string,
  operations: SeedOperation[]
): Promise<void> {
  for (const operation of operations) {
    if (!operation.table) {
      throw new Error('Seed operation requires "table".');
    }

    switch (operation.type) {
      case 'insert':
      case 'upsert': {
        const rows = operation.rows ?? [];
        if (rows.length === 0) {
          throw new Error(`Operation "${operation.type}" on ${operation.table} requires "rows".`);
        }
        const upsertBy = operation.type === 'upsert' ? operation.upsertBy ?? [] : [];
        console.info(
          `${operation.type.toUpperCase()} ${rows.length} row(s) into ${operation.table}${upsertBy.length ? ` (upsert by ${upsertBy.join(', ')})` : ''}...`
        );
        for (const row of rows) {
          const resolvedRow = await resolveSeedRow(runtime, db, row);
          const sql = buildInsertSql(operation.table, resolvedRow, upsertBy);
          await runPsqlWithRuntime(runtime, db, sql);
        }
        break;
      }
      case 'update': {
        if (!operation.where || !operation.set) {
          throw new Error(`Operation "update" on ${operation.table} requires "where" and "set".`);
        }
        const resolvedWhere = (await resolveSeedRow(runtime, db, operation.where)) as Record<string, unknown>;
        const resolvedSet = (await resolveSeedRow(runtime, db, operation.set)) as Record<string, unknown>;
        const sql = buildUpdateSql(operation.table, resolvedSet, resolvedWhere);
        console.info(`UPDATE ${operation.table}...`);
        await runPsqlWithRuntime(runtime, db, sql);
        break;
      }
      case 'delete': {
        if (!operation.where) {
          throw new Error(`Operation "delete" on ${operation.table} requires "where".`);
        }
        const resolvedWhere = (await resolveSeedRow(runtime, db, operation.where)) as Record<string, unknown>;
        const sql = buildDeleteSql(operation.table, resolvedWhere);
        console.info(`DELETE ${operation.table}...`);
        await runPsqlWithRuntime(runtime, db, sql);
        break;
      }
      default:
        throw new Error(`Unsupported seed operation type "${String((operation as { type?: string }).type)}".`);
    }
  }
}

async function applyYamlSeedForDatabase(
  runtime: PostgresRuntime,
  db: string,
  config: {
    tables?: Record<string, SeedTable>;
    operations?: SeedOperation[];
  },
  label?: string
): Promise<void> {
  const scope = label ? `[${label}] ` : '';
  const tables = config.tables;
  const operations = config.operations ?? [];
  if ((!tables || Object.keys(tables).length === 0) && operations.length === 0) {
    console.info(`${scope}No tables/operations found for ${db}.`);
    return;
  }

  console.info(`${scope}Applying YAML seed to ${db}...`);
  if (tables && Object.keys(tables).length > 0) {
    await applyTableSeeds(runtime, db, tables);
  }
  if (operations.length > 0) {
    await applySeedOperations(runtime, db, operations);
  }
  console.info(`${scope}YAML seed completed on ${db}.`);
}

async function applyYamlSeed(options: PostgresSeedYamlOptions): Promise<void> {
  const defaultDb = options.db ?? 'postgres';
  const absolute = path.isAbsolute(options.seed) ? options.seed : path.resolve(process.cwd(), options.seed);
  const contents = await fs.readFile(absolute, 'utf-8');
  const seed = YAML.parse(contents) as SeedYaml;
  const globalVariables = seed?.variables ?? {};
  const hasDefaultPayload =
    Boolean(seed?.tables && Object.keys(seed.tables).length > 0) ||
    Boolean(seed?.operations && seed.operations.length > 0);
  const hasDatabasesPayload = Boolean(seed?.databases && Object.keys(seed.databases).length > 0);

  if (!hasDefaultPayload && !hasDatabasesPayload) {
    console.info(`No tables/operations/databases found in seed file ${absolute}.`);
    return;
  }

  if (hasDefaultPayload) {
    const runtime = resolvePostgresRuntime(options, defaultDb);
    const defaultTables = applySeedVariables(seed.tables ?? {}, globalVariables) as Record<string, SeedTable>;
    const defaultOperations = applySeedVariables(
      seed.operations ?? [],
      globalVariables
    ) as SeedOperation[];
    await applyYamlSeedForDatabase(
      runtime,
      defaultDb,
      { tables: defaultTables, operations: defaultOperations },
      'default'
    );
  }

  if (hasDatabasesPayload && seed.databases) {
    for (const [databaseKey, dbConfig] of Object.entries(seed.databases)) {
      const dbName = dbConfig.db ?? databaseKey;
      const target = dbConfig.target ?? databaseKey;
      const runtime = resolvePostgresRuntime(
        {
          service: options.service,
          user: options.user,
          composeDir: options.composeDir,
          target
        },
        target
      );
      const mergedVariables = {
        ...globalVariables,
        ...(dbConfig.variables ?? {})
      };
      const scopedTables = applySeedVariables(
        dbConfig.tables ?? {},
        mergedVariables
      ) as Record<string, SeedTable>;
      const scopedOperations = applySeedVariables(
        dbConfig.operations ?? [],
        mergedVariables
      ) as SeedOperation[];
      await applyYamlSeedForDatabase(
        runtime,
        dbName,
        { tables: scopedTables, operations: scopedOperations },
        databaseKey
      );
    }
  }
}

function isSeedRef(value: unknown): value is SeedRef {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as SeedRef;
  return Boolean(candidate.ref && candidate.ref.table && candidate.ref.where);
}

async function resolveSeedRow(
  runtime: PostgresRuntime,
  db: string,
  row: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (isSeedRef(value)) {
      resolved[key] = await resolveSeedRef(runtime, db, value.ref);
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

async function resolveSeedRef(
  runtime: PostgresRuntime,
  db: string,
  ref: SeedRef['ref']
): Promise<unknown> {
  const column = ref.column ?? 'id';
  const whereClauses = Object.entries(ref.where).map(([field, value]) => {
    return `${quoteIdentifier(field)} = ${toSqlValue(value)}`;
  });
  const whereSql = whereClauses.length ? ` WHERE ${whereClauses.join(' AND ')}` : '';
  const sql = `SELECT ${quoteIdentifier(column)} FROM ${quoteIdentifier(ref.table)}${whereSql} LIMIT 1;`;
  const output = await runPsqlWithRuntimeCapture(runtime, db, sql);
  const value = output.trim();
  if (!value) {
    throw new Error(`Seed ref not found: ${ref.table}(${whereClauses.join(', ') || 'no filter'})`);
  }
  if (/^-?\d+$/.test(value)) {
    try {
      return BigInt(value);
    } catch {
      return value;
    }
  }
  return value;
}

type PrismaSchemaInfo = {
  envVar?: string;
  url?: string;
  user?: string;
  password?: string;
};

async function resolvePrismaSchemaInfo(
  schemaPath: string,
  runtime: PostgresRuntime,
  db: string
): Promise<PrismaSchemaInfo> {
  const schema = await fs.readFile(schemaPath, 'utf-8');
  const envMatch = schema.match(/url\s*=\s*env\(\s*["']([^"']+)["']\s*\)/i);
  const urlMatch = schema.match(/url\s*=\s*["']([^"']+)["']\s*/i);
  const envVar = envMatch?.[1];
  const explicitUrl = urlMatch?.[1];

  if (explicitUrl) {
    return { url: explicitUrl };
  }

  if (envVar && process.env[envVar]) {
    const url = process.env[envVar] as string;
    const parsed = parseDatabaseUrl(url);
    return { envVar, url, ...parsed };
  }

  const inferredUrl = inferDatabaseUrl(runtime, db);
  const parsed = parseDatabaseUrl(inferredUrl);
  console.info(
    `Prisma DATABASE_URL not set; using inferred URL for diff (env: ${envVar ?? 'DATABASE_URL'}).`
  );
  return { envVar: envVar ?? 'DATABASE_URL', url: inferredUrl, ...parsed };
}

function inferDatabaseUrl(runtime: PostgresRuntime, db: string): string {
  if (runtime.mode === 'direct' && !runtime.host) {
    throw new Error('Missing Postgres host for direct mode.');
  }
  const host = runtime.mode === 'direct' ? runtime.host ?? 'localhost' : 'localhost';
  const port = runtime.port ?? 5432;
  const user = runtime.user ?? 'postgres';
  const password =
    runtime.password ?? process.env.POSTGRES_PASSWORD ?? process.env.PG_PASSWORD ?? 'postgres';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(
    password
  )}@${host}:${port}/${encodeURIComponent(db)}?schema=public`;
}

function parseDatabaseUrl(url: string): { user?: string; password?: string } {
  try {
    const parsed = new URL(url);
    const user = parsed.username ? decodeURIComponent(parsed.username) : undefined;
    const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
    return { user, password };
  } catch {
    return {};
  }
}

async function ensureRoleAndGrant(
  runtime: PostgresRuntime,
  db: string,
  user: string,
  password: string
): Promise<void> {
  const safeUser = user.replace(/"/g, '""');
  const safeDb = db.replace(/"/g, '""');
  const sql = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${safeUser}') THEN
    CREATE ROLE "${safeUser}" LOGIN PASSWORD '${password.replace(/'/g, "''")}';
  END IF;
END$$;
GRANT ALL PRIVILEGES ON DATABASE "${safeDb}" TO "${safeUser}";
`.trim();
  console.info(`Ensuring role "${safeUser}" exists and has privileges on "${safeDb}"...`);
  await runPsqlWithRuntime(runtime, runtime.adminDb, sql);
}

type PrismaSchemaPreparation = {
  schemaPath: string;
  cleanup: () => Promise<void>;
};

async function preparePrismaSchemaForCli(schemaPath: string): Promise<PrismaSchemaPreparation> {
  const absolute = path.isAbsolute(schemaPath)
    ? schemaPath
    : path.resolve(process.cwd(), schemaPath);
  const schema = await fs.readFile(absolute, 'utf-8');

  if (!/datasource\s+\w+\s*\{[\s\S]*?\burl\s*=/.test(schema)) {
    return { schemaPath: absolute, cleanup: async () => {} };
  }

  const sanitized = schema.replace(
    /(datasource\s+\w+\s*\{[\s\S]*?\n)(\s*url\s*=\s*.*\n)/,
    '$1'
  );
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'virt-prisma-schema-'));
  const tempSchema = path.join(tempDir, 'schema.prisma');
  await fs.writeFile(tempSchema, sanitized, 'utf-8');
  return {
    schemaPath: tempSchema,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

async function generateSqlFromPrismaSchema(
  schemaPath: string,
  prismaInfo: PrismaSchemaInfo
): Promise<string> {
  const envVar = prismaInfo.envVar ?? 'DATABASE_URL';
  const env = prismaInfo.url ? { ...process.env, [envVar]: prismaInfo.url } : process.env;
  const outputDir = await fs.mkdtemp(path.join(tmpdir(), 'virt-prisma-'));
  const outputFile = path.join(outputDir, 'schema.sql');
  const prepared = await preparePrismaSchemaForCli(schemaPath);

  try {
    const { stderr: outputStderr } = await runCommandCapture(
      'npx',
      [
        '--yes',
        'prisma',
        'migrate',
        'diff',
        '--from-empty',
        '--to-schema',
        prepared.schemaPath,
        '--script',
        '--output',
        outputFile
      ],
      {
        cwd: process.cwd(),
        env
      }
    );

    try {
      const sql = await fs.readFile(outputFile, 'utf-8');
      if (sql.trim()) {
        return sql;
      }
    } catch {
      // Fallback: some Prisma versions don't write --output for diff+script.
      const { stdout, stderr } = await runCommandCapture(
        'npx',
        [
          '--yes',
          'prisma',
          'migrate',
          'diff',
          '--from-empty',
          '--to-schema',
          prepared.schemaPath,
          '--script'
        ],
        {
          cwd: process.cwd(),
          env
        }
      );
      if (stdout.trim()) {
        return stdout;
      }
      // Some versions may emit SQL to stderr; detect if it looks like SQL.
      if (/\bcreate\s+table\b|\bcreate\s+index\b|\bcreate\s+type\b/i.test(stderr)) {
        return stderr;
      }
      const details = stderr.trim() || outputStderr.trim();
      throw new Error(
        details
          ? `Prisma diff produced no SQL output. Details: ${details}`
          : 'Prisma diff produced no SQL output.'
      );
    }

    // If file exists but is empty, surface stderr if present.
    const details = outputStderr.trim();
    throw new Error(
      details
        ? `Prisma diff produced no SQL output. Details: ${details}`
        : 'Prisma diff produced no SQL output.'
    );
  } finally {
    await prepared.cleanup();
    await fs.rm(outputDir, { recursive: true, force: true });
  }
}

async function runPrismaDbPush(schemaPath: string, prismaInfo: PrismaSchemaInfo): Promise<void> {
  const envVar = prismaInfo.envVar ?? 'DATABASE_URL';
  const env = prismaInfo.url ? { ...process.env, [envVar]: prismaInfo.url } : process.env;
  const prepared = await preparePrismaSchemaForCli(schemaPath);
  const args = ['--yes', 'prisma', 'db', 'push', '--schema', prepared.schemaPath];
  if (prismaInfo.url) {
    args.push('--url', prismaInfo.url);
  }
  try {
    await runCommand(
      'npx',
      args,
      {
        cwd: process.cwd(),
        env
      }
    );
  } finally {
    await prepared.cleanup();
  }
}

export function registerPostgresCommand(program: Command): void {
  const postgres = program.command('postgres').description('Manage Postgres data seeds');
  postgres.showHelpAfterError('\nUse "virt postgres <command> --help" to inspect options.\n');

  postgres
    .command('create-db <name>')
    .summary('Create a database (optionally drop it first) and apply schema SQL')
    .option('-s, --service <name>', 'Docker Compose service name', DEFAULT_SERVICE)
    .option('-u, --user <name>', 'Database user', DEFAULT_USER)
    .option('-a, --admin-db <name>', 'Admin database name', DEFAULT_ADMIN_DB)
    .option('-t, --target <name>', 'Database target from config (overrides postgres settings)')
    .option('--drop', 'Drop database before creating it', false)
    .option('-y, --yes', 'Skip confirmation for destructive actions', false)
    .option('--schema-dir <path>', 'Directory with .sql or .prisma files to apply')
    .option('--schema-file <path>', 'Single .sql or .prisma file to apply')
    .option('--compose-dir <path>', 'Directory with docker-compose.yml', DEFAULT_COMPOSE_DIR)
    .action(async (name: string, options: PostgresCreateDbOptions) => {
      try {
        const runtime = resolvePostgresRuntime(options, name);

        if (options.drop && !options.yes) {
          throw new Error('Use --yes to confirm dropping the database.');
        }

        if (runtime.mode === 'direct') {
          if (!runtime.host) {
            throw new Error('Missing Postgres host for direct mode.');
          }
          await waitForPostgresDirect(
            runtime.host,
            runtime.port ?? 5432,
            runtime.user,
            runtime.password,
            runtime.adminDb,
            runtime.ssl,
            30,
            2
          );
        } else {
          await waitForPostgresCompose(
            runtime.service,
            runtime.user,
            runtime.adminDb,
            runtime.composeDir,
            30,
            2
          );
        }

        if (options.drop) {
          const exists =
            runtime.mode === 'direct'
              ? await databaseExistsDirect(
                  runtime.host ?? '',
                  runtime.port ?? 5432,
                  runtime.user,
                  runtime.password,
                  runtime.adminDb,
                  runtime.ssl,
                  name
                )
              : await databaseExistsCompose(
                  runtime.service,
                  runtime.user,
                  runtime.adminDb,
                  runtime.composeDir,
                  name
                );
          if (exists) {
            console.info(`Dropping database "${name}"...`);
            if (runtime.mode === 'direct') {
              await dropDatabaseDirect(
                runtime.host ?? '',
                runtime.port ?? 5432,
                runtime.user,
                runtime.password,
                runtime.adminDb,
                runtime.ssl,
                name
              );
            } else {
              await dropDatabaseCompose(
                runtime.service,
                runtime.user,
                runtime.adminDb,
                runtime.composeDir,
                name
              );
            }
          }
        }

        const exists =
          runtime.mode === 'direct'
            ? await databaseExistsDirect(
                runtime.host ?? '',
                runtime.port ?? 5432,
                runtime.user,
                runtime.password,
                runtime.adminDb,
                runtime.ssl,
                name
              )
            : await databaseExistsCompose(
                runtime.service,
                runtime.user,
                runtime.adminDb,
                runtime.composeDir,
                name
              );
        if (!exists) {
          console.info(`Creating database "${name}"...`);
          if (runtime.mode === 'direct') {
            await createDatabaseDirect(
              runtime.host ?? '',
              runtime.port ?? 5432,
              runtime.user,
              runtime.password,
              runtime.adminDb,
              runtime.ssl,
              name
            );
          } else {
            await createDatabaseCompose(
              runtime.service,
              runtime.user,
              runtime.adminDb,
              runtime.composeDir,
              name
            );
          }
          console.info(`Database "${name}" created.`);
        } else {
          console.info(`Database "${name}" already exists.`);
        }

        await applySchemaFiles(runtime, name, options.schemaDir, options.schemaFile);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error while creating database: ${message}`);
        process.exitCode = 1;
      }
    });

  postgres
    .command('drop-db <name>')
    .summary('Drop a database')
    .option('-s, --service <name>', 'Docker Compose service name', DEFAULT_SERVICE)
    .option('-u, --user <name>', 'Database user', DEFAULT_USER)
    .option('-a, --admin-db <name>', 'Admin database name', DEFAULT_ADMIN_DB)
    .option('-t, --target <name>', 'Database target from config (overrides postgres settings)')
    .option('-y, --yes', 'Skip confirmation for destructive actions', false)
    .option('--compose-dir <path>', 'Directory with docker-compose.yml', DEFAULT_COMPOSE_DIR)
    .action(async (name: string, options: PostgresDropDbOptions) => {
      try {
        const runtime = resolvePostgresRuntime(options, name);

        if (!options.yes) {
          throw new Error('Use --yes to confirm dropping the database.');
        }

        if (runtime.mode === 'direct') {
          if (!runtime.host) {
            throw new Error('Missing Postgres host for direct mode.');
          }
          await waitForPostgresDirect(
            runtime.host,
            runtime.port ?? 5432,
            runtime.user,
            runtime.password,
            runtime.adminDb,
            runtime.ssl,
            30,
            2
          );
        } else {
          await waitForPostgresCompose(
            runtime.service,
            runtime.user,
            runtime.adminDb,
            runtime.composeDir,
            30,
            2
          );
        }

        const exists =
          runtime.mode === 'direct'
            ? await databaseExistsDirect(
                runtime.host ?? '',
                runtime.port ?? 5432,
                runtime.user,
                runtime.password,
                runtime.adminDb,
                runtime.ssl,
                name
              )
            : await databaseExistsCompose(
                runtime.service,
                runtime.user,
                runtime.adminDb,
                runtime.composeDir,
                name
              );
        if (!exists) {
          console.info(`Database "${name}" does not exist.`);
          return;
        }
        console.info(`Dropping database "${name}"...`);
        if (runtime.mode === 'direct') {
          await dropDatabaseDirect(
            runtime.host ?? '',
            runtime.port ?? 5432,
            runtime.user,
            runtime.password,
            runtime.adminDb,
            runtime.ssl,
            name
          );
        } else {
          await dropDatabaseCompose(
            runtime.service,
            runtime.user,
            runtime.adminDb,
            runtime.composeDir,
            name
          );
        }
        console.info(`Database "${name}" dropped.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error while dropping database: ${message}`);
        process.exitCode = 1;
      }
    });

  postgres
    .command('seed')
    .summary('Run SQL seed files against a database')
    .option('-s, --service <name>', 'Docker Compose service name', DEFAULT_SERVICE)
    .option('-u, --user <name>', 'Database user', DEFAULT_USER)
    .option('-d, --db <name>', 'Database name', 'postgres')
    .option('-t, --target <name>', 'Database target from config (overrides postgres settings)')
    .option('--sql-file <path>', 'SQL file to execute')
    .option('--sql-dir <path>', 'Directory with .sql files to execute in order')
    .option('--compose-dir <path>', 'Directory with docker-compose.yml', DEFAULT_COMPOSE_DIR)
    .action(async (options: PostgresSeedGenericOptions) => {
      try {
        if (!options.sqlFile && !options.sqlDir) {
          throw new Error('Provide --sql-file or --sql-dir.');
        }

        const runtime = resolvePostgresRuntime(options, options.db ?? 'postgres');
        const db = options.db ?? 'postgres';

        if (options.sqlFile) {
          const filePath = path.isAbsolute(options.sqlFile)
            ? options.sqlFile
            : path.resolve(process.cwd(), options.sqlFile);
          const sql = await fs.readFile(filePath, 'utf-8');
          console.info(`Seeding ${db} from ${filePath}...`);
          await runPsqlWithRuntime(runtime, db, sql);
          console.info('Seed completed.');
          return;
        }

        const dir = path.isAbsolute(options.sqlDir as string)
          ? (options.sqlDir as string)
          : path.resolve(process.cwd(), options.sqlDir as string);
        const entries = await fs.readdir(dir);
        const sqlFiles = entries.filter(name => name.toLowerCase().endsWith('.sql')).sort();
        if (sqlFiles.length === 0) {
          console.info(`No .sql files found in ${dir}.`);
          return;
        }
        for (const file of sqlFiles) {
          const fullPath = path.join(dir, file);
          const sql = await fs.readFile(fullPath, 'utf-8');
          console.info(`Seeding ${db} from ${fullPath}...`);
          await runPsqlWithRuntime(runtime, db, sql);
        }
        console.info('Seed completed.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error while running seed: ${message}`);
        process.exitCode = 1;
      }
    });

  postgres
    .command('seed-yaml')
    .summary('Run YAML seed data against one or many databases')
    .option('-s, --service <name>', 'Docker Compose service name', DEFAULT_SERVICE)
    .option('-u, --user <name>', 'Database user', DEFAULT_USER)
    .option('-d, --db <name>', 'Database name', 'postgres')
    .option('-t, --target <name>', 'Database target from config (overrides postgres settings)')
    .requiredOption('--seed <path>', 'YAML seed file to execute')
    .option('--compose-dir <path>', 'Directory with docker-compose.yml', DEFAULT_COMPOSE_DIR)
    .action(async (options: PostgresSeedYamlOptions) => {
      try {
        await applyYamlSeed(options);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error while running YAML seed: ${message}`);
        process.exitCode = 1;
      }
    });
}
