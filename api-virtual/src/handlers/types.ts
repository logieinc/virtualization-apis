import type { Request, Response } from 'express';

export interface HandlerContext {
  params: Request['params'];
  query: Request['query'];
  body: Request['body'];
  resources: Record<string, unknown>;
  meta: {
    now: string;
    randomId: string;
    requestId: string;
  };
  req: Request;
  res: Response;
}

export interface HandlerResult {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export type HandlerFn = (
  context: HandlerContext
) => HandlerResult | void | Promise<HandlerResult | void>;
