import { Express } from "express";
import { createRequireAuth } from "./routes/middleware.js";
import { RouteContext } from "./routes/types.js";
import { registerConfigRoutes } from "./routes/endpoints/config.js";
import { registerAuthRoutes } from "./routes/endpoints/auth.js";
import { registerHaRoutes } from "./routes/endpoints/ha.js";
import { registerServiceAccountRoutes } from "./routes/endpoints/service-accounts.js";
import { registerScriptCrudRoutes } from "./routes/endpoints/scripts.js";
import { registerRunRoutes } from "./routes/endpoints/run.js";
import { registerWebhookRoutes } from "./routes/endpoints/webhook.js";

const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-for-dev";
const USE_MOCKS = process.env.MOCK !== "disabled";

const getAuthentikBaseUrl = () => {
  if (process.env.AUTHENTIK_URL) return process.env.AUTHENTIK_URL;
  if (process.env.AUTHENTIK_ISSUER) {
    try {
      return new URL(process.env.AUTHENTIK_ISSUER).origin;
    } catch {
      return null;
    }
  }
  return null;
};

export function setupRoutes(app: Express) {
  const requireAuth = createRequireAuth(JWT_SECRET, USE_MOCKS);

  const ctx: RouteContext = {
    JWT_SECRET,
    USE_MOCKS,
    requireAuth,
    getAuthentikBaseUrl,
  };

  registerConfigRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerHaRoutes(app, ctx);
  registerServiceAccountRoutes(app, ctx);
  registerScriptCrudRoutes(app, ctx);
  registerRunRoutes(app, ctx);
  registerWebhookRoutes(app, ctx);
}
