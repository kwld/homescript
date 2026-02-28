import { RequestHandler } from "express";

export interface RouteContext {
  JWT_SECRET: string;
  USE_MOCKS: boolean;
  requireAuth: RequestHandler;
  getAuthentikBaseUrl: () => string | null;
}
