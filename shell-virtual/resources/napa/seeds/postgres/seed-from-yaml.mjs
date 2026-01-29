import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const TYPE = process.argv[2];
const VALID_TYPES = new Set(["security-users", "wallet-operations"]);

if (!VALID_TYPES.has(TYPE)) {
  console.error("Usage: node seed-from-yaml.mjs <security-users|wallet-operations>");
  process.exit(1);
}

const baseDir = path.dirname(fileURLToPath(import.meta.url));
const seedFile = process.env.SEED_FILE || path.join(baseDir, "seed-data.yml");
const seedIndex = Number.parseInt(process.env.SEED_INDEX || "0", 10);

if (!fs.existsSync(seedFile)) {
  console.error(`Seed file not found: ${seedFile}`);
  process.exit(1);
}

const raw = fs.readFileSync(seedFile, "utf8");
const data = YAML.parse(raw) || {};

const randomSuffix = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

const sqlEscape = (value) => String(value).replace(/'/g, "''");

const sqlValue = (value) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return `'${sqlEscape(value)}'`;
};

const sqlJsonValue = (value) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "string") return `'${sqlEscape(value)}'::jsonb`;
  return `'${sqlEscape(JSON.stringify(value))}'::jsonb`;
};

const pickEntry = (key) => {
  const list = Array.isArray(data[key]) ? data[key] : [];
  if (list.length === 0) {
    console.error(`No entries found for ${key} in ${seedFile}`);
    process.exit(1);
  }
  const index = Number.isFinite(seedIndex) ? seedIndex : 0;
  const entry = list[index];
  if (!entry) {
    console.error(`No entry at index ${index} for ${key} in ${seedFile}`);
    process.exit(1);
  }
  return entry;
};

if (TYPE === "security-users") {
  const entry = pickEntry("security_users");
  const suffix = randomSuffix();

  const identifier = entry.identifier || crypto.randomUUID();
  const partyId = entry.partyId || crypto.randomUUID();
  const name = entry.name || `user ${suffix}`;
  const username = entry.username || `user_${suffix}`;
  const email = entry.email || `${username}@email.com`;
  const password =
    entry.password ||
    "$2a$10$40SJnt2xBh9KAesy8qGH5umpGqxFJdIWw8m3KaiKT9NXgMd2PAlpi";
  const status = entry.status || "ACTIVE";
  const metadata = entry.metadata || {
    type: "person",
    chain: `chain_${suffix}`,
    status: "ACTIVE",
    partyId,
    partyType: "person",
  };
  const algorithm = entry.algorithm ?? null;
  const canLogin = entry.canLogin ?? true;
  const createdAt = entry.createdAt ? sqlValue(entry.createdAt) : "now()";
  const updatedAt = entry.updatedAt ? sqlValue(entry.updatedAt) : "now()";

  const sql = `
INSERT INTO "User" (
  identifier, name, username, email, password, "partyId",
  "createdAt", "updatedAt", status, metadata, algorithm, "canLogin"
) VALUES (
  ${sqlValue(identifier)},
  ${sqlValue(name)},
  ${sqlValue(username)},
  ${sqlValue(email)},
  ${sqlValue(password)},
  ${sqlValue(partyId)},
  ${createdAt},
  ${updatedAt},
  ${sqlValue(status)},
  ${sqlJsonValue(metadata)},
  ${sqlValue(algorithm)},
  ${sqlValue(canLogin)}
)
ON CONFLICT (email) DO NOTHING;
`.trim();

  process.stdout.write(`${sql}\n`);
} else {
  const entry = pickEntry("wallet_operations");
  const suffix = randomSuffix();

  const currency = entry.currency || {
    id: "USD",
    name: "US Dollar",
    symbol: "$",
    decimalPrecision: 0.01,
    type: "fiat",
  };

  const party = entry.party || {};
  const account = entry.account || {};
  const operation = entry.operation || {};

  const partyIdentifier = party.identifier || crypto.randomUUID();
  const partyName = party.name || `user_${suffix}`;
  const partyType = party.type || "person";
  const partyChain = party.chain || `chain_${suffix}`;
  const partyStatus = party.status || "ACTIVE";
  const partyVisible = party.visible ?? true;
  const partyMetadata = party.metadata || {
    type: partyType,
    email: `user_${suffix}@email.com`,
    userName: `user_${suffix}`,
  };

  const accountIdentifier = account.identifier || crypto.randomUUID();
  const accountName = account.name || `acct_${suffix}`;
  const accountCurrencyId = account.currencyId || currency.id;
  const accountStatus = account.status || "active";
  const balances = account.balances || {};

  const amount =
    operation.amount ?? Math.floor(Math.random() * 10000) + 1;
  const operationType = operation.operationType || "deposit";
  const operationSubtype = operation.subtype || "seed";
  const operationStatus = operation.status || "CREATED";

  const sql = `
INSERT INTO "Currency" (id, name, symbol, "decimalPrecision", type)
VALUES (
  ${sqlValue(currency.id)},
  ${sqlValue(currency.name)},
  ${sqlValue(currency.symbol)},
  ${sqlValue(currency.decimalPrecision)},
  ${sqlValue(currency.type)}
)
ON CONFLICT (id) DO NOTHING;

WITH upsert_party AS (
  INSERT INTO "Party" (
    name, identifier, type, chain, status, visible, metadata, "createdAt", "updatedAt"
  ) VALUES (
    ${sqlValue(partyName)},
    ${sqlValue(partyIdentifier)},
    ${sqlValue(partyType)},
    ${sqlValue(partyChain)},
    ${sqlValue(partyStatus)},
    ${sqlValue(partyVisible)},
    ${sqlJsonValue(partyMetadata)},
    now(),
    now()
  )
  ON CONFLICT (identifier) DO UPDATE SET "updatedAt" = now()
  RETURNING id, chain
),
party_row AS (
  SELECT id, chain FROM upsert_party
  UNION ALL
  SELECT id, chain FROM "Party" WHERE identifier = ${sqlValue(partyIdentifier)} LIMIT 1
),
upsert_account AS (
  INSERT INTO "Account" (
    name, "currencyId", status, chain, "partyId", identifier,
    "availableBalance", "depositBalance", "payoutBalance", "bonusBalance",
    "pendingBalance", "blockedBalance",
    "createdAt", "updatedAt"
  )
  SELECT
    ${sqlValue(accountName)},
    ${sqlValue(accountCurrencyId)},
    ${sqlValue(accountStatus)},
    p.chain,
    p.id,
    ${sqlValue(accountIdentifier)},
    ${sqlValue(balances.available ?? 0)},
    ${sqlValue(balances.deposit ?? 0)},
    ${sqlValue(balances.payout ?? 0)},
    ${sqlValue(balances.bonus ?? 0)},
    ${sqlValue(balances.pending ?? 0)},
    ${sqlValue(balances.blocked ?? 0)},
    now(),
    now()
  FROM party_row p
  ON CONFLICT (identifier) DO UPDATE SET "updatedAt" = now()
  RETURNING id, chain
),
account_row AS (
  SELECT id, chain FROM upsert_account
  UNION ALL
  SELECT id, chain FROM "Account" WHERE identifier = ${sqlValue(accountIdentifier)} LIMIT 1
)
INSERT INTO "Operation" (
  amount, "operationType", subtype, status, timestamp, "destinationAccountId", chain, "createdBy", "createdAt", "updatedAt"
)
SELECT
  ${sqlValue(amount)},
  ${sqlValue(operationType)},
  ${sqlValue(operationSubtype)},
  ${sqlValue(operationStatus)},
  now(),
  a.id,
  a.chain,
  NULL,
  now(),
  now()
FROM account_row a;
`.trim();

  process.stdout.write(`${sql}\n`);
}
