export interface SimulationParty {
  id: string;
  amount: number;
  currency: string;
  metadata?: Record<string, unknown>;
}

export interface SimulationDocument {
  name: string;
  description?: string;
  effectiveDate?: string;
  parties: SimulationParty[];
  metadata?: Record<string, unknown>;
}

export interface SimulationOptions {
  apiBaseUrl?: string;
  dryRun?: boolean;
}

export type PartyTypeLiteral = 'AFFILIATE' | 'PLAYER' | 'ORGANIZATION';

export interface PartyYamlInput {
  name: string;
  alias?: string;
  aliases?: string[];
  type: PartyTypeLiteral;
  balance?: number;
  currency?: string;
  metadata?: Record<string, unknown>;
  utm?: Record<string, string>;
  qrIdentifier?: string;
  externalIdentifier?: string;
  status?: string;
  children?: PartyYamlInput[];
}

export interface PartyDocument {
  name?: string;
  description?: string;
  parties: PartyYamlInput[];
}

export interface PartyDTO {
  id: string;
  shortId: string;
  name: string;
  alias?: string | null;
  aliases: string[];
  type: PartyTypeLiteral;
  orgId?: string | null;
  metadata?: Record<string, unknown> | null;
  utm?: Record<string, string> | null;
  qrIdentifier?: string | null;
  externalIdentifier?: string | null;
  status: string;
  balance: string;
  currency?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedResult<T> {
  totalRecords: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
  lastUpdate?: string;
  data: T[];
}

export type PartyListResponse = PaginatedResult<PartyDTO>;
