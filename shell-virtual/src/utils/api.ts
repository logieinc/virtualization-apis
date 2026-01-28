import axios, { AxiosInstance } from 'axios';

const DEFAULT_API_URL = process.env.API_URL || 'http://localhost:4000';

export function resolveApiBaseUrl(explicit?: string): string {
  const base = (explicit || DEFAULT_API_URL).trim();
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

export function createApiClient(baseUrl?: string): AxiosInstance {
  return axios.create({
    baseURL: resolveApiBaseUrl(baseUrl),
    timeout: 30_000,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}
