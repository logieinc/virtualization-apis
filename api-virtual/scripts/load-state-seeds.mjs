import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const root = path.resolve(process.argv[2] || '.');
const mongoUri = process.env.VIRTUAL_STATE_MONGO_URI
  || process.env.MONGO_URI
  || 'mongodb://mongo:mongo@localhost:27017/virtual?authSource=admin';
const database = process.env.VIRTUAL_STATE_MONGO_DATABASE || 'virtual';
const stateCollection = process.env.VIRTUAL_STATE_MONGO_COLLECTION || 'virtual_state';

function walkJsonFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJsonFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(full);
    }
  }
  return files;
}

function readDocuments(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (Array.isArray(parsed.documents)) {
    return parsed.documents;
  }
  throw new Error(`State seed must be an array or { "documents": [] }: ${file}`);
}

const files = walkJsonFiles(root);
const documents = files.flatMap(file => readDocuments(file));

const client = new MongoClient(mongoUri);
await client.connect();
try {
  const collection = client.db(database).collection(stateCollection);
  await collection.createIndex({ api: 1, collection: 1, key: 1 }, { unique: true });
  await collection.createIndex({ api: 1, collection: 1 });
  await collection.createIndex({ api: 1, collection: 1, appId: 1 });
  for (const raw of documents) {
    const doc = { ...raw };
    if (!doc.api || !doc.collection || !doc.key) {
      throw new Error(`State document requires api, collection, and key: ${JSON.stringify(doc)}`);
    }
    const now = new Date().toISOString();
    doc.updatedAt = doc.updatedAt ?? now;
    await collection.updateOne(
      { api: doc.api, collection: doc.collection, key: doc.key },
      {
        $set: doc,
        $setOnInsert: { createdAt: doc.createdAt ?? now }
      },
      { upsert: true }
    );
  }
} finally {
  await client.close();
}

console.log(`loaded ${documents.length} state document(s) from ${files.length} file(s) into ${database}.${stateCollection}`);
