import { config as loadEnv } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const CONFIG_FILES = [
  'virt.config.yaml',
  'virt.config.yml',
  '.virt.yaml',
  '.virt.yml',
  '.env.yaml',
  '.env.yml'
];

type ConfigSource = 'yaml' | 'env';

export interface PostgresConfig {
  mode?: 'compose' | 'direct';
  service?: string;
  user?: string;
  password?: string;
  host?: string;
  port?: number;
  adminDb?: string;
  composeDir?: string;
  ssl?: boolean;
}

export interface OpensearchConfig {
  url?: string;
  user?: string;
  password?: string;
}

export interface MongoConfig {
  url?: string;
  db?: string;
}

export interface EnvironmentConfig {
  name: string;
  apiUrl?: string;
  variables?: Record<string, string>;
  postgres?: PostgresConfig;
  databases?: Record<string, PostgresConfig>;
  opensearch?: OpensearchConfig;
  mongo?: MongoConfig;
  projectsDir?: string;
}

interface RawYamlEnvironment {
  apiUrl?: string;
  variables?: Record<string, string>;
  postgres?: Record<string, unknown>;
  databases?: Record<string, Record<string, unknown>>;
  opensearch?: Record<string, unknown>;
  mongo?: Record<string, unknown>;
  paths?: Record<string, string>;
}

interface RawYamlConfig {
  default?: string;
  variables?: Record<string, string>;
  environments?: Record<string, RawYamlEnvironment>;
}

export interface ResolveResult {
  source: ConfigSource;
  envName: string;
  env?: EnvironmentConfig;
}

const cwd = process.cwd();

const defaultEnvPath = path.resolve(cwd, '.env');
if (existsSync(defaultEnvPath)) {
  loadEnv({ path: defaultEnvPath });
} else {
  loadEnv();
}

const sanitizeRecord = (record?: Record<string, string>): Record<string, string> | undefined => {
  if (!record) {
    return undefined;
  }
  const normalized = Object.entries(record).reduce<Record<string, string>>((acc, [key, value]) => {
    if (typeof value === 'string' && value.trim()) {
      acc[key.trim().toUpperCase()] = value;
    }
    return acc;
  }, {});
  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const expandPlaceholders = (
  value: string,
  variables?: Record<string, string>,
  fallbackVariables?: Record<string, string>
): string => {
  return value.replace(/\$\{([^}]+)\}/g, (match, rawKey) => {
    const key = String(rawKey).trim().toUpperCase();
    const replacement =
      variables?.[key] ?? fallbackVariables?.[key] ?? process.env[key as keyof NodeJS.ProcessEnv];
    return typeof replacement === 'string' && replacement.length > 0 ? replacement : match;
  });
};

const expandObject = (
  value: unknown,
  variables?: Record<string, string>,
  fallbackVariables?: Record<string, string>
): unknown => {
  if (typeof value === 'string') {
    return expandPlaceholders(value, variables, fallbackVariables);
  }
  if (Array.isArray(value)) {
    return value.map(item => expandObject(item, variables, fallbackVariables));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>(
      (acc, [key, val]) => {
        acc[key] = expandObject(val, variables, fallbackVariables);
        return acc;
      },
      {}
    );
  }
  return value;
};

const coercePostgresConfig = (raw?: Record<string, unknown>): PostgresConfig | undefined => {
  if (!raw) return undefined;
  const result: PostgresConfig = {};

  if (typeof raw.mode === 'string') {
    result.mode = raw.mode === 'direct' ? 'direct' : 'compose';
  }
  if (typeof raw.service === 'string') result.service = raw.service;
  if (typeof raw.user === 'string') result.user = raw.user;
  if (typeof raw.password === 'string') result.password = raw.password;
  if (typeof raw.host === 'string') result.host = raw.host;
  if (typeof raw.port === 'number') result.port = raw.port;
  if (typeof raw.port === 'string' && raw.port.trim()) result.port = Number(raw.port);
  if (typeof raw.adminDb === 'string') result.adminDb = raw.adminDb;
  if (typeof raw.composeDir === 'string') result.composeDir = raw.composeDir;
  if (typeof raw.ssl === 'boolean') result.ssl = raw.ssl;
  if (typeof raw.ssl === 'string') result.ssl = raw.ssl.toLowerCase() === 'true';

  return Object.keys(result).length > 0 ? result : undefined;
};

const coerceDatabasesConfig = (
  raw?: Record<string, Record<string, unknown>>
): Record<string, PostgresConfig> | undefined => {
  if (!raw) return undefined;
  const normalized = Object.entries(raw).reduce<Record<string, PostgresConfig>>((acc, [key, val]) => {
    const cfg = coercePostgresConfig(val);
    if (cfg) {
      acc[key.trim()] = cfg;
    }
    return acc;
  }, {});
  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const coerceOpensearchConfig = (raw?: Record<string, unknown>): OpensearchConfig | undefined => {
  if (!raw) return undefined;
  const result: OpensearchConfig = {};
  if (typeof raw.url === 'string') result.url = raw.url;
  if (typeof raw.user === 'string') result.user = raw.user;
  if (typeof raw.password === 'string') result.password = raw.password;
  return Object.keys(result).length > 0 ? result : undefined;
};

const coerceMongoConfig = (raw?: Record<string, unknown>): MongoConfig | undefined => {
  if (!raw) return undefined;
  const result: MongoConfig = {};
  if (typeof raw.url === 'string') result.url = raw.url;
  if (typeof raw.db === 'string') result.db = raw.db;
  return Object.keys(result).length > 0 ? result : undefined;
};

const findConfigPath = (): string | undefined => {
  for (const file of CONFIG_FILES) {
    const candidate = path.resolve(cwd, file);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
};

let cachedConfig: RawYamlConfig | null | undefined;
let cachedConfigPath: string | undefined;

const loadYamlConfig = (): RawYamlConfig | null => {
  if (cachedConfig !== undefined) {
    return cachedConfig;
  }
  const configPath = findConfigPath();
  cachedConfigPath = configPath;
  if (!configPath) {
    cachedConfig = null;
    return cachedConfig;
  }
  const raw = readFileSync(configPath, 'utf-8');
  cachedConfig = (parseYaml(raw) || null) as RawYamlConfig | null;
  return cachedConfig;
};

const resolveEnvironmentName = (config: RawYamlConfig | null, envName?: string): string => {
  if (envName && envName.trim()) {
    return envName.trim();
  }
  const fromEnv = process.env.VIRT_ENV;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.trim();
  }
  if (config?.default) {
    return config.default;
  }
  const envKeys = config?.environments ? Object.keys(config.environments) : [];
  return envKeys[0] ?? 'default';
};

export const getConfigSourcePath = (): string | undefined => cachedConfigPath ?? findConfigPath();

export const resolveEnvironment = (envName?: string): ResolveResult => {
  const config = loadYamlConfig();
  const selected = resolveEnvironmentName(config, envName);

  if (!config || !config.environments) {
    return { source: 'env', envName: selected };
  }

  const envRaw = config.environments[selected];
  if (!envRaw) {
    return { source: 'yaml', envName: selected };
  }

  const baseVariables = sanitizeRecord(config.variables);
  const envVariables = sanitizeRecord(envRaw.variables);
  const expanded = expandObject(envRaw, envVariables, baseVariables) as RawYamlEnvironment;

  const postgres = coercePostgresConfig(expanded.postgres as Record<string, unknown> | undefined);
  const databases = coerceDatabasesConfig(
    expanded.databases as Record<string, Record<string, unknown>> | undefined
  );
  const opensearch = coerceOpensearchConfig(expanded.opensearch as Record<string, unknown> | undefined);
  const mongo = coerceMongoConfig(expanded.mongo as Record<string, unknown> | undefined);

  const projectsDir = expanded.paths?.projectsDir || expanded.paths?.workspace;

  return {
    source: 'yaml',
    envName: selected,
    env: {
      name: selected,
      apiUrl: expanded.apiUrl,
      variables: envVariables ?? baseVariables,
      postgres,
      databases,
      opensearch,
      mongo,
      projectsDir
    }
  };
};
