import { Command } from 'commander';

import {
  PaginatedResult,
  PartyDTO,
  PartyDocument,
  PartyYamlInput,
  PartyTypeLiteral,
  PartyListResponse
} from '../types';
import { readPartyFile, resolveProjectFile } from '../utils/file-utils';
import { createApiClient, resolveApiBaseUrl } from '../utils/api';

interface ResetOptions {
  api?: string;
  removeRoots?: boolean;
}

interface LoadOptions {
  parent: string;
  api?: string;
  dryRun?: boolean;
  project?: string;
}

interface ShowOptions {
  api?: string;
  json?: boolean;
}

interface TreeOptions {
  api?: string;
  depth?: string;
}

interface AncestorsOptions {
  api?: string;
  json?: boolean;
}

interface ListOptions {
  api?: string;
  json?: boolean;
  page?: string;
  pageSize?: string;
  type?: string[];
  status?: string;
}

type PartyTreeNode = {
  node: PartyDTO;
  children: PartyTreeNode[];
};

interface MoveOptions {
  api?: string;
  mode?: string;
  depth?: string;
}

function resolvePartyFilePath(file: string | undefined, project?: string): string {
  if (project) {
    const filename = file ?? 'parties.yaml';
    return resolveProjectFile(project, filename);
  }
  if (!file) {
    throw new Error('You must provide a file path or specify --project.');
  }
  return file;
}

export function registerPartiesCommand(program: Command): void {
  const parties = program.command('parties').description('Manage parties via the API');
  parties.showHelpAfterError('\nUse "virt parties <command> --help" to inspect options.\n');
  parties.addHelpText('after', '\nUse "virt parties <command> --help" to inspect options for a specific subcommand.\n');

  parties
    .command('reset')
    .summary('Delete all parties (optionally preserving root organizations)')
    .description(`Options:
  --remove-roots        Delete root organizations too
  -a, --api <url>       API base URL (defaults to API_URL env var)
`)
    .option('--remove-roots', 'Also remove organizations without parent', false)
    .option('-a, --api <url>', 'API base URL', process.env.API_URL)
    .action(async (options: ResetOptions) => {
      try {
        await resetParties(options);
      } catch (error) {
        handleCliError(error);
      }
    });

  parties
    .command('load [file]')
    .summary('Load parties from a YAML file and attach them under a parent organization')
    .requiredOption('-p, --parent <identifier>', 'Parent organization identifier (UUID or shortId)')
    .option('--dry-run', 'Preview the operations without sending them to the API', false)
    .option('-a, --api <url>', 'API base URL', process.env.API_URL)
    .option('-P, --project <name>', 'Project name under PROJECTS_DIR to resolve default files')
    .action(async (file: string | undefined, options: LoadOptions, command: Command) => {
      if (file === 'help') {
        command.help();
        return;
      }
      try {
        await loadParties(file, options);
      } catch (error) {
        handleCliError(error);
      }
    });

  parties
    .command('bootstrap <project>')
    .summary('Load parties from projects/<project>/parties.yaml')
    .requiredOption('-p, --parent <identifier>', 'Parent organization identifier (UUID or shortId)')
    .option('--dry-run', 'Preview the operations without sending them to the API', false)
    .option('-a, --api <url>', 'API base URL', process.env.API_URL)
    .action(async (project: string, options: LoadOptions, command: Command) => {
      if (project === 'help') {
        command.help();
        return;
      }
      try {
        await loadParties(undefined, { ...options, project });
      } catch (error) {
        handleCliError(error);
      }
    });

  parties
    .command('show <identifier>')
    .description('Retrieve a party by UUID or shortId')
    .option('--json', 'Output raw JSON instead of a formatted summary', false)
    .option('-a, --api <url>', 'API base URL', process.env.API_URL)
    .summary('Retrieve a party by UUID or shortId')
    .description(`Options:
  -a, --api <url>       API base URL (defaults to API_URL env var)
      --json            Output raw JSON
`)
    .action(async (identifier: string, options: ShowOptions, command: Command) => {
      if (identifier === 'help') {
        command.help();
        return;
      }
      try {
        await showParty(identifier, options);
      } catch (error) {
        handleCliError(error);
      }
    });

  parties
    .command('tree [identifier]')
    .summary('Display the party hierarchy starting at the provided identifier')
    .description(`Options:
  -d, --depth <depth>   Max depth to traverse (default 5)
  -a, --api <url>       API base URL (defaults to API_URL env var)
`)
    .option('-d, --depth <depth>', 'Max depth to traverse (default: 5)', '5')
    .option('-a, --api <url>', 'API base URL', process.env.API_URL)
    .action(async (identifier: string | undefined, options: TreeOptions, command: Command) => {
      if (identifier === 'help') {
        command.help();
        return;
      }
      try {
        await showTree(identifier, options);
      } catch (error) {
        handleCliError(error);
      }
    });

  parties
    .command('ancestors <identifier>')
    .summary('List the ancestors of a party from closest to farthest')
    .description(`Options:
  -a, --api <url>       API base URL (defaults to API_URL env var)
      --json            Output raw JSON
`)
    .option('--json', 'Output raw JSON', false)
    .option('-a, --api <url>', 'API base URL', process.env.API_URL)
    .action(async (identifier: string, options: AncestorsOptions, command: Command) => {
      if (identifier === 'help') {
        command.help();
        return;
      }
      try {
        await showAncestors(identifier, options);
      } catch (error) {
        handleCliError(error);
      }
    });

  parties
    .command('list')
    .summary('List all parties currently available')
    .description(`Options:
  -a, --api <url>       API base URL (defaults to API_URL env var)
      --json            Output raw JSON
`)
    .option('--json', 'Output raw JSON', false)
    .option('--type <types...>', 'Filter by party type(s) (AFFILIATE | PLAYER | ORGANIZATION)')
    .option('--status <status>', 'Filter by party status')
    .option('--page <number>', 'Page number to retrieve', '1')
    .option('--page-size <number>', 'Number of items per page (max 100)', '25')
    .option('-a, --api <url>', 'API base URL', process.env.API_URL)
    .action(async (options: ListOptions) => {
      try {
        await listParties(options);
      } catch (error) {
        handleCliError(error);
      }
    });

  parties
    .command('move <identifier> <newParent>')
    .summary('Move a party (and its subtree) under a new parent')
    .description(`Options:
  -a, --api <url>       API base URL (defaults to API_URL env var)
  -m, --mode <mode>     Move strategy: node | children | descendants (default node)
  -d, --depth <number>  Depth selector (>=1) when mode is "descendants"
`)
    .option('-a, --api <url>', 'API base URL', process.env.API_URL)
    .option('-m, --mode <mode>', 'Move strategy: node | children | descendants')
    .option('-d, --depth <number>', 'Depth selector (>=1) used with mode=descendants or to adjust children moves')
    .action(async (identifier: string, newParent: string, options: MoveOptions, command: Command) => {
      if (identifier === 'help' || newParent === 'help') {
        command.help();
        return;
      }
      try {
        validateIdentifier('Identifier', identifier);
        validateIdentifier('New parent identifier', newParent);
        if (identifier === newParent) {
          throw new Error('Identifier and new parent must be different.');
        }
        await moveParty(identifier, newParent, options);
      } catch (error) {
        handleCliError(error);
      }
    });
}

async function resetParties(options: ResetOptions): Promise<void> {
  const baseUrl = resolveApiBaseUrl(options.api);
  const client = createApiClient(baseUrl);
  const parties = await fetchAllParties(client);

  if (parties.length === 0) {
    console.info('No parties found. Nothing to reset.');
    return;
  }

  const removable = parties.filter(party => options.removeRoots || party.orgId !== null);
  if (removable.length === 0) {
    console.info('Only root organizations exist. Use --remove-roots to delete them.');
    return;
  }

  const partyById = new Map<string, PartyDTO>(parties.map(item => [item.id, item]));
  const deletableIds = new Set(removable.map(item => item.id));
  const childrenMap = new Map<string, Set<string>>();

  for (const party of parties) {
    if (party.orgId) {
      if (!childrenMap.has(party.orgId)) {
        childrenMap.set(party.orgId, new Set());
      }
      childrenMap.get(party.orgId)!.add(party.id);
    }
  }

  const childCount = new Map<string, number>();
  for (const party of removable) {
    const children = childrenMap.get(party.id);
    if (!children) {
      childCount.set(party.id, 0);
      continue;
    }
    const count = Array.from(children).filter(childId => deletableIds.has(childId)).length;
    childCount.set(party.id, count);
  }

  const queue: string[] = removable
    .filter(party => (childCount.get(party.id) ?? 0) === 0)
    .map(party => party.id);

  const processed = new Set<string>();
  let deleted = 0;

  while (queue.length > 0) {
    const currentId = queue.pop()!;
    if (processed.has(currentId)) {
      continue;
    }
    processed.add(currentId);

    const party = partyById.get(currentId);
    if (!party) {
      continue;
    }

    await client.delete(`/parties/${party.id}`);
    deleted += 1;
    console.info(`Deleted ${party.shortId} (${party.name})`);

    if (party.orgId && deletableIds.has(party.orgId)) {
      const remaining = (childCount.get(party.orgId) ?? 0) - 1;
      childCount.set(party.orgId, Math.max(remaining, 0));
      if (remaining <= 0) {
        queue.push(party.orgId);
      }
    }
  }

  const skipped = removable.length - deleted;
  console.info(`Reset complete. Deleted ${deleted} parties.${skipped > 0 ? ` Skipped ${skipped} (probably due to dependency issues).` : ''}`);
  console.info('');
}

async function loadParties(file: string | undefined, options: LoadOptions): Promise<void> {
  const baseUrl = resolveApiBaseUrl(options.api);
  const client = createApiClient(baseUrl);
  const effectiveFile = resolvePartyFilePath(file, options.project);
  const document = await readPartyFile(effectiveFile);

  const parent = await fetchParty(client, options.parent);
  console.info(`Loading parties from ${effectiveFile} under ${parent.shortId} (${parent.name})`);

  let created = 0;

  const processNode = async (parentId: string, node: PartyYamlInput, level: number): Promise<void> => {
    const indentation = '  '.repeat(level);
    let currentParentId = parentId;

    if (options.dryRun) {
      console.info(`${indentation}Would create party "${node.name}" (${node.type}) under parent ${parentId}`);
    } else {
      const payload = buildPartyPayload(node, parentId);
      const { data: createdParty } = await client.post<PartyDTO>('/parties', payload);
      created += 1;
      console.info(`${indentation}Created ${createdParty.shortId} (${createdParty.name})`);
      currentParentId = createdParty.id;
    }

    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        await processNode(currentParentId, child, level + 1);
      }
    }
  };

  for (const node of document.parties) {
    await processNode(parent.id, node, 0);
  }

  if (options.dryRun) {
    console.info('Dry run complete. No changes were sent to the API.');
    console.info('');
  } else {
    console.info(`Finished loading parties. Created ${created} records.`);
    console.info('');
  }
}

function buildPartyPayload(node: PartyYamlInput, parentId: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: node.name,
    type: node.type,
    orgId: parentId
  };

  if (node.alias !== undefined) payload.alias = node.alias;
  if (node.aliases !== undefined) payload.aliases = node.aliases;
  if (node.metadata !== undefined) payload.metadata = node.metadata;
  if (node.utm !== undefined) payload.utm = node.utm;
  if (node.qrIdentifier !== undefined) payload.qrIdentifier = node.qrIdentifier;
  if (node.externalIdentifier !== undefined) payload.externalIdentifier = node.externalIdentifier;
  if (node.status !== undefined) payload.status = node.status;
  if (node.balance !== undefined) payload.balance = node.balance;
  if (node.currency !== undefined) payload.currency = node.currency;

  return payload;
}

async function showParty(identifier: string, options: ShowOptions): Promise<void> {
  const baseUrl = resolveApiBaseUrl(options.api);
  const client = createApiClient(baseUrl);
  const party = await fetchParty(client, identifier);

  if (options.json) {
    console.log(JSON.stringify(party, null, 2));
    return;
  }

  console.info(`${party.shortId} (${party.name})`);
  console.info(`Type: ${party.type}`);
  console.info(`Alias: ${party.alias ?? '-'}`);
  console.info(`Parent: ${party.orgId ?? 'root'}`);
  console.info(`Currency: ${party.currency ?? '-'}`);
  console.info(`Balance: ${party.balance}`);
  console.info(`Status: ${party.status}`);
  if (party.metadata) {
    console.info('Metadata:', JSON.stringify(party.metadata, null, 2));
  }
  if (party.utm) {
    console.info('UTM:', JSON.stringify(party.utm, null, 2));
  }
  console.info('');
}

async function showTree(identifier: string | undefined, options: TreeOptions): Promise<void> {
  const baseUrl = resolveApiBaseUrl(options.api);
  const client = createApiClient(baseUrl);
  const depth = parseDepth(options.depth);

  if (!identifier) {
    const data = await fetchAllParties(client);
    const roots = data.filter(party => !party.orgId);
    if (roots.length === 0) {
      console.info('No root organizations found.');
      console.info('');
      return;
    }

    for (const root of roots) {
      await showTree(root.shortId ?? root.id, options);
    }
    return;
  }

  const root = await fetchParty(client, identifier);
  const descendants = await fetchAllPaginated<PartyDTO>(
    client,
    `/parties/${identifier}/descendants`
  );

  const nodes = [root, ...descendants];
  const childrenMap = new Map<string, PartyDTO[]>();
  for (const party of nodes) {
    if (!party.orgId) continue;
    if (!childrenMap.has(party.orgId)) {
      childrenMap.set(party.orgId, []);
    }
    childrenMap.get(party.orgId)!.push(party);
  }

  for (const [, list] of childrenMap) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  const tree: PartyTreeNode = {
    node: root,
    children: buildTree(root.id, childrenMap, depth, 1)
  };

  printTree(tree);
  console.info('');
}

function buildTree(
  parentId: string,
  childrenMap: Map<string, PartyDTO[]>,
  depth: number,
  currentDepth: number
): PartyTreeNode[] {
  if (currentDepth > depth) {
    return [];
  }

  const children = childrenMap.get(parentId) ?? [];
  return children.map(child => ({
    node: child,
    children: buildTree(child.id, childrenMap, depth, currentDepth + 1)
  }));
}

async function showAncestors(identifier: string, options: AncestorsOptions): Promise<void> {
  const baseUrl = resolveApiBaseUrl(options.api);
  const client = createApiClient(baseUrl);
  const ancestors = await fetchAllPaginated<PartyDTO>(
    client,
    `/parties/${identifier}/ancestors`
  );

  if (options.json) {
    console.log(JSON.stringify(ancestors, null, 2));
    return;
  }

  if (ancestors.length === 0) {
    console.info('No ancestors found (entity is probably a root organization).');
    console.info('');
    return;
  }

  console.info(
    ancestors
      .map((ancestor, index) => `${index + 1}. ${ancestor.shortId} (${ancestor.name})`)
      .join('\n')
  );
  console.info('');
}

async function listParties(options: ListOptions): Promise<void> {
  const baseUrl = resolveApiBaseUrl(options.api);
  const client = createApiClient(baseUrl);
  const page = options.page ? parsePositiveInteger(options.page, 'page') : 1;
  const pageSize = options.pageSize ? parsePositiveInteger(options.pageSize, 'pageSize') : 25;
  if (pageSize > 100) {
    throw new Error('pageSize must be <= 100.');
  }

  const params: Record<string, unknown> = { page, pageSize };
  if (options.type && options.type.length > 0) {
    params.type = options.type.map(item => item.toUpperCase());
  }
  if (options.status) {
    params.status = options.status.toUpperCase();
  }

  const { data } = await client.get<PartyListResponse>('/parties', { params });

  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (data.data.length === 0) {
    console.info('No parties found for the requested page.');
    console.info('');
    return;
  }

  const rows = data.data.map(item => ({
    shortId: item.shortId ?? '(missing)',
    id: item.id,
    name: item.name,
    type: item.type,
    currency: item.currency ?? '-',
    balance: item.balance,
    parent: item.orgId ?? 'root',
    status: item.status
  }));

  console.table(rows);
  const totalPages = data.totalPages === 0 ? 1 : data.totalPages;
  console.info(`Page ${data.currentPage} of ${totalPages} — ${data.totalRecords} total parties.`);
  console.info('');
}

function printTree(tree: PartyTreeNode): void {
  const icon = getTypeIcon(tree.node.type);
  const label = `${tree.node.shortId ?? '(missing)'} (${tree.node.name})`;
  console.info(`${icon} ${label}`);
  tree.children.forEach((child, index) => {
    const last = index === tree.children.length - 1;
    printSubtree(child, '', last);
  });
}

function printSubtree(tree: PartyTreeNode, prefix: string, isLast: boolean): void {
  const icon = getTypeIcon(tree.node.type);
  const label = `${tree.node.shortId ?? '(missing)'} (${tree.node.name})`;
  const connector = isLast ? '└─ ' : '├─ ';
  console.info(`${prefix}${connector}${icon} ${label}`);

  const childPrefix = `${prefix}${isLast ? '   ' : '│  '}`;
  tree.children.forEach((child, index) => {
    const last = index === tree.children.length - 1;
    printSubtree(child, childPrefix, last);
  });
}

function getTypeIcon(type: PartyTypeLiteral): string {
  switch (type) {
    case 'ORGANIZATION':
      return '🏢';
    case 'AFFILIATE':
      return '🤝';
    case 'PLAYER':
      return '🎮';
    default:
      return '❓';
  }
}

async function fetchParty(client: ReturnType<typeof createApiClient>, identifier: string): Promise<PartyDTO> {
  const { data } = await client.get<PartyDTO>(`/parties/${identifier}`);
  return data;
}

async function fetchAllParties(client: ReturnType<typeof createApiClient>): Promise<PartyDTO[]> {
  return fetchAllPaginated<PartyDTO>(client, '/parties');
}

async function fetchAllPaginated<T>(
  client: ReturnType<typeof createApiClient>,
  url: string,
  params: Record<string, unknown> = {},
  pageSize = 100
): Promise<T[]> {
  const items: T[] = [];
  let page = 1;

  while (true) {
    const { data } = await client.get<PaginatedResult<T>>(url, {
      params: { ...params, page, pageSize }
    });

    items.push(...data.data);
    if (data.totalPages === 0 || data.currentPage >= data.totalPages) {
      break;
    }
    page = data.currentPage + 1;
  }

  return items;
}

function parseDepth(raw?: string): number {
  if (!raw) return 5;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error('Depth must be a positive integer.');
  }
  return parsed;
}

async function moveParty(identifier: string, newParent: string, options: MoveOptions): Promise<void> {
  const baseUrl = resolveApiBaseUrl(options.api);
  const client = createApiClient(baseUrl);
  const payload: Record<string, unknown> = { newParentId: newParent };

  if (options.mode) {
    const normalized = options.mode.toLowerCase();
    if (!['node', 'children', 'descendants'].includes(normalized)) {
      throw new Error('Mode must be one of: node, children, descendants.');
    }
    payload.mode = normalized;
  }

  if (options.depth !== undefined) {
    payload.depth = parsePositiveInteger(options.depth, 'depth');
  }

  await client.post(`/parties/${identifier}/move`, payload);
  console.info(`Moved ${identifier} under ${newParent}.`);
  console.info('');
}

function handleCliError(error: unknown): void {
  if (error && typeof error === 'object' && 'response' in error) {
    const err = error as {
      response?: {
        status?: number;
        data?: unknown;
        config?: { data?: unknown; headers?: unknown };
      };
    };
    console.error(`API error (status ${err.response?.status ?? 'unknown'}):`, err.response?.data ?? error);
    if (err.response?.config?.data) {
      console.error('Sent payload:', err.response.config.data);
    }
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  console.error('');
  process.exitCode = 1;
}

function validateIdentifier(label: string, value: string): void {
  const uuidRegex = /^[0-9a-fA-F-]{36}$/;
  const shortRegex = /^[A-Z]{3,}-[A-Za-z0-9_-]{6,}$/;
  if (!uuidRegex.test(value) && !shortRegex.test(value)) {
    throw new Error(`${label} must be a valid UUID or shortId (prefix-XXXXXXXX).`);
  }
}

function parsePositiveInteger(raw: string, label: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}
