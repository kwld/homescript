import { Express } from "express";
import { v4 as uuidv4 } from "uuid";
import { RouteContext } from "../types.js";
import { createServiceAccount, deleteServiceAccount, getServiceAccounts } from "../../db.js";
import { createRateLimit } from "../rate-limit.js";

export const registerServiceAccountRoutes = (app: Express, ctx: RouteContext) => {
  const serviceAccountRateLimit = createRateLimit({
    maxRequests: 20,
    windowMs: 60_000,
    key: (req) => `${req.ip}:service-account:${(req as any).user?.id || "anon"}`,
    errorMessage: "Too many service account management requests",
  });

  app.get("/api/service-accounts", ctx.requireAuth, (_req, res) => {
    res.json(getServiceAccounts());
  });

  app.post("/api/service-accounts", ctx.requireAuth, serviceAccountRateLimit, (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });

    const id = uuidv4();
    const apiKey = `sk_${uuidv4().replace(/-/g, "")}`;
    createServiceAccount(id, name, apiKey);

    res.json({
      id,
      name,
      apiKey,
      serviceId: id,
      serviceSecret: apiKey,
      headers: {
        "x-service-id": id,
        "x-service-secret": apiKey,
      },
    });
  });

  app.delete("/api/service-accounts/:id", ctx.requireAuth, serviceAccountRateLimit, (req, res) => {
    deleteServiceAccount(req.params.id);
    res.json({ success: true });
  });
};
