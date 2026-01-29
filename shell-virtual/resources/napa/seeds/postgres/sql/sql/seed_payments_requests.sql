-- Seed de ejemplo para api_payments. Ajusta según tus FKs y catálogos.

-- Esquema mínimo para pruebas (no pretende ser completo)
CREATE TABLE IF NOT EXISTS "Currency" (
  "identifier" TEXT PRIMARY KEY,
  name TEXT,
  symbol TEXT,
  "decimalPrecision" NUMERIC,
  type TEXT,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW(),
  "createdBy" TEXT
);

CREATE TABLE IF NOT EXISTS "Request" (
  "identifier" TEXT PRIMARY KEY,
  amount BIGINT NOT NULL,
  "releasedAmount" BIGINT,
  subtype TEXT,
  status TEXT DEFAULT 'CREATED',
  "decimalPrecision" NUMERIC,
  timestamp TIMESTAMP DEFAULT NOW(),
  "channelExternalReference" TEXT,
  "channelIntegrationReference" TEXT,
  "walletOperationIdentifier" TEXT,
  comment TEXT,
  "sourceAccountUsername" TEXT,
  "destinationAccountUsername" TEXT,
  "sourceAccountIdentifier" TEXT,
  "destinationAccountIdentifier" TEXT,
  metadata JSONB,
  channel TEXT,
  integration TEXT,
  chain TEXT,
  direction TEXT,
  "availableBalanceBefore" BIGINT,
  "depositBalanceBefore" BIGINT,
  "payoutBalanceBefore" BIGINT,
  "bonusBalanceBefore" BIGINT,
  "pendingBalanceBefore" BIGINT,
  "blockedBalanceBefore" BIGINT,
  "availableBalanceAfter" BIGINT,
  "depositBalanceAfter" BIGINT,
  "payoutBalanceAfter" BIGINT,
  "bonusBalanceAfter" BIGINT,
  "pendingBalanceAfter" BIGINT,
  "blockedBalanceAfter" BIGINT,
  "manualProcessingReason" TEXT,
  "currencyId" TEXT REFERENCES "Currency"("identifier"),
  "requestType" TEXT,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW(),
  "createdBy" TEXT,
  "requesterIp" TEXT,
  "allowedIps" TEXT,
  "browserFingerprint" TEXT,
  immediate BOOLEAN DEFAULT FALSE
);

INSERT INTO "Currency" ("identifier", name, symbol, "decimalPrecision", type, "createdAt", "updatedAt", "createdBy")
VALUES ('USD', 'US Dollar', '$', 0.01, 'fiat', now(), now(), 'seed')
ON CONFLICT ("identifier") DO NOTHING;

-- Sin requests en data.json; agrega inserts aquí si necesitás seedearlas.
