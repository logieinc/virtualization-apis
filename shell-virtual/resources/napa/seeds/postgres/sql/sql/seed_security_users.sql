-- Seed de ejemplo para api_security. Ajusta según tus reglas de negocio.

-- Esquema mínimo para pruebas (no pretende ser completo)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "User" (
  id SERIAL PRIMARY KEY,
  identifier TEXT UNIQUE,
  name TEXT NOT NULL,
  username TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  password TEXT,
  "partyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW(),
  status TEXT DEFAULT 'ACTIVE',
  metadata JSONB,
  algorithm TEXT,
  "canLogin" BOOLEAN DEFAULT TRUE
);

WITH seed AS (
  SELECT
    substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) AS run_id,
    gen_random_uuid()::text AS identifier,
    gen_random_uuid()::text AS party_id
)
INSERT INTO "User" (
  identifier, name, username, email, password, "partyId",
  "createdAt", "updatedAt", status, metadata, algorithm, "canLogin"
)
SELECT
  s.identifier,
  'juan pino ' || s.run_id,
  'jpino_' || s.run_id,
  'jpino_' || s.run_id || '@email.com',
  '$2a$10$40SJnt2xBh9KAesy8qGH5umpGqxFJdIWw8m3KaiKT9NXgMd2PAlpi',
  s.party_id,
  now(),
  now(),
  'ACTIVE',
  jsonb_build_object(
    'type', 'person',
    'chain', 'chain_' || s.run_id,
    'status', 'ACTIVE',
    'created', now(),
    'partyId', s.party_id,
    'currency', jsonb_build_object('name', 'US Dollar', 'type', 'fiat', 'symbol', '$', 'decimalPrecision', 0.01),
    'partyType', 'person'
  ),
  NULL,
  true
FROM seed s
ON CONFLICT (email) DO UPDATE
SET
  identifier = EXCLUDED.identifier,
  name = EXCLUDED.name,
  username = EXCLUDED.username,
  "partyId" = EXCLUDED."partyId",
  metadata = EXCLUDED.metadata,
  "updatedAt" = now();
