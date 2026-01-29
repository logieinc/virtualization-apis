-- Seed de ejemplo para api_wallet. Ajusta campos y valores según tus FKs.
-- Crea una moneda, una party, una cuenta y algunas operaciones simples.

-- Esquema mínimo para pruebas (no pretende ser completo)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "Currency" (
  id TEXT PRIMARY KEY,
  name TEXT,
  symbol TEXT,
  "decimalPrecision" NUMERIC,
  type TEXT
);

CREATE TABLE IF NOT EXISTS "Party" (
  id BIGSERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  identifier TEXT UNIQUE,
  type TEXT NOT NULL,
  chain TEXT NOT NULL,
  status TEXT DEFAULT 'ACTIVE',
  visible BOOLEAN DEFAULT TRUE,
  metadata JSONB,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "Account" (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  "currencyId" TEXT REFERENCES "Currency"(id),
  status TEXT DEFAULT 'active',
  chain TEXT NOT NULL,
  "partyId" BIGINT REFERENCES "Party"(id),
  identifier TEXT UNIQUE,
  "availableBalance" BIGINT DEFAULT 0,
  "depositBalance" BIGINT DEFAULT 0,
  "payoutBalance" BIGINT DEFAULT 0,
  "bonusBalance" BIGINT DEFAULT 0,
  "pendingBalance" BIGINT DEFAULT 0,
  "blockedBalance" BIGINT DEFAULT 0,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "Operation" (
  id BIGSERIAL PRIMARY KEY,
  amount BIGINT NOT NULL,
  "operationType" TEXT NOT NULL,
  subtype TEXT,
  status TEXT DEFAULT 'CREATED',
  timestamp TIMESTAMP DEFAULT NOW(),
  "destinationAccountId" BIGINT REFERENCES "Account"(id),
  chain TEXT NOT NULL,
  "createdBy" INT,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

INSERT INTO "Currency" (id, name, symbol, "decimalPrecision", type)
VALUES ('USD', 'US Dollar', '$', 0.01, 'fiat')
ON CONFLICT (id) DO NOTHING;

WITH seed AS (
  SELECT
    substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) AS run_id,
    gen_random_uuid()::text AS party_identifier,
    gen_random_uuid()::text AS account_identifier
),
new_party AS (
  INSERT INTO "Party" (
    name, identifier, type, chain, status, visible, metadata, "createdAt", "updatedAt"
  )
  SELECT
    'user_' || s.run_id,
    s.party_identifier,
    'person',
    'chain_' || s.run_id,
    'ACTIVE',
    true,
    jsonb_build_object(
      'type', 'person',
      'email', 'user_' || s.run_id || '@email.com',
      'userName', 'user_' || s.run_id,
      'city', 'test',
      'country', 'test'
    ),
    now(),
    now()
  FROM seed s
  RETURNING id, identifier, chain
),
new_account AS (
  INSERT INTO "Account" (
    name, "currencyId", status, chain, "partyId", identifier,
    "availableBalance", "depositBalance", "payoutBalance", "bonusBalance",
    "pendingBalance", "blockedBalance",
    "createdAt", "updatedAt"
  )
  SELECT
    'acct_' || s.run_id,
    'USD',
    'active',
    p.chain,
    p.id,
    s.account_identifier,
    0, 0, 0, 0, 0, 0,
    now(),
    now()
  FROM seed s
  JOIN new_party p ON true
  RETURNING id, chain
)
INSERT INTO "Operation" (
  amount, "operationType", subtype, status, timestamp, "destinationAccountId", chain, "createdBy", "createdAt", "updatedAt"
)
SELECT
  (random() * 10000)::int + 1,
  'deposit',
  'seed',
  'CREATED',
  now(),
  a.id,
  a.chain,
  NULL,
  now(),
  now()
FROM new_account a;
