import { promises as fs } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Command } from 'commander';
import { MongoClient, ObjectId } from 'mongodb';
import YAML from 'yaml';

const YAML_EXTENSIONS = new Set(['.yaml', '.yml']);

type MongoBaseOptions = {
  uri: string;
  db: string;
  yes?: boolean;
};

type MongoInsertOptions = MongoBaseOptions;

type MongoFindOptions = MongoBaseOptions & {
  filter?: string;
  limit?: number;
  skip?: number;
  sort?: string;
  table?: boolean;
  fields?: string;
};

type MongoDeleteOptions = MongoBaseOptions & {
  id?: string;
  filter?: string;
};

type MongoExportOptions = MongoBaseOptions & {
  filter?: string;
  limit?: number;
  format?: 'json' | 'yaml';
  output?: string;
};

function resolveMongoOptions(options: MongoBaseOptions): { uri: string; db: string; yes?: boolean } {
  return {
    uri: options.uri ?? process.env.MONGO_URL ?? 'mongodb://localhost:27017',
    db: options.db ?? process.env.MONGO_DB ?? 'virtual',
    yes: options.yes
  };
}

async function confirmAction(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`${message} (y/N) `);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
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

function parseObjectId(value: string): string | ObjectId {
  if (ObjectId.isValid(value) && value.length === 24) {
    return new ObjectId(value);
  }
  return value;
}

async function withMongoClient<T>(
  uri: string,
  dbName: string,
  handler: (db: ReturnType<MongoClient['db']>) => Promise<T>
): Promise<T> {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    return await handler(db);
  } finally {
    await client.close();
  }
}

export function registerMongoCommand(program: Command): void {
  const mongo = program.command('mongo').description('Manage MongoDB data');

  mongo
    .command('list-collections')
    .description('List collections in a database.')
    .option('-u, --uri <uri>', 'Mongo connection URI')
    .option('-d, --db <name>', 'Database name')
    .action(async (options: MongoBaseOptions) => {
      try {
        const resolved = resolveMongoOptions(options);
        await withMongoClient(resolved.uri, resolved.db, async db => {
          const collections = await db.listCollections().toArray();
          const rows = collections.map(item => ({
            name: item.name,
            type: item.type ?? 'collection'
          }));
          console.table(rows);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error while listing Mongo collections: ${message}`);
        process.exitCode = 1;
      }
    });

  mongo
    .command('insert <collection> <file>')
    .description('Insert document(s) into a collection from JSON/YAML.')
    .option('-u, --uri <uri>', 'Mongo connection URI')
    .option('-d, --db <name>', 'Database name')
    .action(async (collection: string, file: string, options: MongoInsertOptions) => {
      try {
        const payload = await loadStructuredFile(file);
        const resolved = resolveMongoOptions(options);
        await withMongoClient(resolved.uri, resolved.db, async db => {
          const target = db.collection(collection);
          if (Array.isArray(payload)) {
            const result = await target.insertMany(payload);
            console.info(`Inserted ${result.insertedCount} document(s) into "${collection}".`);
          } else if (payload && typeof payload === 'object') {
            const result = await target.insertOne(payload as Record<string, unknown>);
            console.info(`Inserted 1 document into "${collection}" (id: ${result.insertedId}).`);
          } else {
            throw new Error('Insert payload must be an object or array of objects.');
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error while inserting Mongo documents: ${message}`);
        process.exitCode = 1;
      }
    });

  mongo
    .command('find <collection>')
    .description('Find documents in a collection.')
    .option('-u, --uri <uri>', 'Mongo connection URI')
    .option('-d, --db <name>', 'Database name')
    .option('-f, --filter <file>', 'JSON/YAML filter file')
    .option('--limit <number>', 'Limit results', value => Number(value))
    .option('--skip <number>', 'Skip results', value => Number(value))
    .option('--sort <json>', 'Sort JSON (e.g. {"createdAt": -1})')
    .option('--table', 'Display results as a table', false)
    .option('--fields <list>', 'Comma-separated fields for table output', 'id,name,type,status')
    .action(async (collection: string, options: MongoFindOptions) => {
      try {
        const filter = options.filter ? (await loadStructuredFile(options.filter)) : {};
        if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
          throw new Error('Filter must be a JSON/YAML object.');
        }
        const sort =
          options.sort && options.sort.trim().length > 0
            ? (JSON.parse(options.sort) as Record<string, 1 | -1>)
            : undefined;

        const resolved = resolveMongoOptions(options);
        await withMongoClient(resolved.uri, resolved.db, async db => {
          let cursor = db.collection(collection).find(filter as Record<string, unknown>);
          if (sort) cursor = cursor.sort(sort);
          if (typeof options.skip === 'number' && !Number.isNaN(options.skip)) {
            cursor = cursor.skip(options.skip);
          }
          if (typeof options.limit === 'number' && !Number.isNaN(options.limit)) {
            cursor = cursor.limit(options.limit);
          }
          const docs = await cursor.toArray();

          if (options.table) {
            const fields = options.fields
              ? options.fields.split(',').map(item => item.trim()).filter(Boolean)
              : ['id', 'name', 'type', 'status'];
            const rows = docs.map(doc => {
              const row: Record<string, unknown> = {
                _id: doc._id?.toString?.() ?? String(doc._id)
              };
              for (const field of fields) {
                row[field] = (doc as Record<string, unknown>)[field];
              }
              return row;
            });
            console.table(rows);
          } else {
            console.info(JSON.stringify(docs, null, 2));
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error while querying Mongo collection: ${message}`);
        process.exitCode = 1;
      }
    });

  mongo
    .command('delete <collection> [id]')
    .description('Delete document(s) from a collection.')
    .option('-u, --uri <uri>', 'Mongo connection URI')
    .option('-d, --db <name>', 'Database name')
    .option('-f, --filter <file>', 'JSON/YAML filter file')
    .option('-y, --yes', 'Skip confirmation prompt', false)
    .action(async (collection: string, id: string | undefined, options: MongoDeleteOptions) => {
      try {
        if (!id && !options.filter) {
          throw new Error('Provide an id or a filter to delete.');
        }
        const filter = id
          ? { _id: parseObjectId(id) }
          : (await loadStructuredFile(options.filter!));
        if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
          throw new Error('Filter must be a JSON/YAML object.');
        }

        if (!options.yes) {
          const ok = await confirmAction(`Delete from "${collection}" with filter ${JSON.stringify(filter)}?`);
          if (!ok) {
            console.info('Aborted.');
            return;
          }
        }

        const resolved = resolveMongoOptions(options);
        await withMongoClient(resolved.uri, resolved.db, async db => {
          const target = db.collection(collection);
          const result = id
            ? await target.deleteOne(filter as Record<string, unknown>)
            : await target.deleteMany(filter as Record<string, unknown>);
          console.info(`Deleted ${result.deletedCount ?? 0} document(s) from "${collection}".`);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error while deleting Mongo documents: ${message}`);
        process.exitCode = 1;
      }
    });

  mongo
    .command('export <collection>')
    .description('Export documents from a collection.')
    .option('-u, --uri <uri>', 'Mongo connection URI')
    .option('-d, --db <name>', 'Database name')
    .option('-f, --filter <file>', 'JSON/YAML filter file')
    .option('--limit <number>', 'Limit results', value => Number(value))
    .option(
      '-t, --format <format>',
      'Output format: json or yaml',
      (value: string) => (value === 'yaml' ? 'yaml' : 'json'),
      'json'
    )
    .option('-o, --output <file>', 'Write output to a file instead of stdout')
    .action(async (collection: string, options: MongoExportOptions) => {
      try {
        const filter = options.filter ? (await loadStructuredFile(options.filter)) : {};
        if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
          throw new Error('Filter must be a JSON/YAML object.');
        }

        const resolved = resolveMongoOptions(options);
        await withMongoClient(resolved.uri, resolved.db, async db => {
          let cursor = db.collection(collection).find(filter as Record<string, unknown>);
          if (typeof options.limit === 'number' && !Number.isNaN(options.limit)) {
            cursor = cursor.limit(options.limit);
          }
          const docs = await cursor.toArray();
          const content =
            options.format === 'yaml' ? YAML.stringify(docs) : JSON.stringify(docs, null, 2);

          if (options.output) {
            const absolutePath = path.isAbsolute(options.output)
              ? options.output
              : path.resolve(process.cwd(), options.output);
            await fs.writeFile(absolutePath, content, 'utf-8');
            console.info(`Exported ${docs.length} document(s) to ${absolutePath}.`);
          } else {
            console.info(content);
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error while exporting Mongo documents: ${message}`);
        process.exitCode = 1;
      }
    });
}
