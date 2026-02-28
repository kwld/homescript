import { Express } from "express";
import { v4 as uuidv4 } from "uuid";
import { RouteContext } from "../types.js";
import {
  createScript,
  deleteScript,
  getScriptById,
  getScripts,
  updateScript,
  updateScriptDebugCode,
  updateScriptDebugMode,
} from "../../db.js";
import { bumpOpenApiRevision } from "../../openapi-revision.js";

export const registerScriptCrudRoutes = (app: Express, ctx: RouteContext) => {
  app.get("/api/scripts", ctx.requireAuth, (_req, res) => {
    res.json(getScripts());
  });

  app.get("/api/scripts/:id", ctx.requireAuth, (req, res) => {
    const script = getScriptById(req.params.id);
    if (!script) return res.status(404).json({ error: "Not found" });
    res.json(script);
  });

  app.post("/api/scripts", ctx.requireAuth, (req, res) => {
    const { name, code, endpoint, testParams, triggerConfig, debugEnabled } = req.body;
    if (!name || !code || !endpoint) return res.status(400).json({ error: "Missing fields" });

    const id = uuidv4();
    try {
      createScript(id, name, code, endpoint, testParams || "{}", triggerConfig || "{}", null, Boolean(debugEnabled));
      bumpOpenApiRevision();
      res.json({
        id,
        name,
        code,
        endpoint,
        testParams: testParams || "{}",
        trigger_config: triggerConfig || "{}",
        debug_enabled: Boolean(debugEnabled),
      });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put("/api/scripts/:id", ctx.requireAuth, (req, res) => {
    const { name, code, endpoint, testParams, triggerConfig } = req.body;
    if (!name || !code || !endpoint) return res.status(400).json({ error: "Missing fields" });

    try {
      updateScript(req.params.id, name, code, endpoint, testParams || "{}", triggerConfig || "{}");
      bumpOpenApiRevision();
      res.json({ id: req.params.id, name, code, endpoint, testParams: testParams || "{}", trigger_config: triggerConfig || "{}" });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put("/api/scripts/:id/debug", ctx.requireAuth, (req, res) => {
    const { debugCode, debugEnabled } = req.body || {};
    if (debugCode !== undefined && debugCode !== null && typeof debugCode !== "string") {
      return res.status(400).json({ error: "debugCode must be string or null" });
    }
    if (debugEnabled !== undefined && typeof debugEnabled !== "boolean") {
      return res.status(400).json({ error: "debugEnabled must be boolean when provided" });
    }
    const script = getScriptById(req.params.id);
    if (!script) return res.status(404).json({ error: "Not found" });
    if (debugCode !== undefined) {
      updateScriptDebugCode(req.params.id, debugCode ?? null);
    }
    if (typeof debugEnabled === "boolean") {
      updateScriptDebugMode(req.params.id, debugEnabled);
    }
    return res.json({ success: true });
  });

  app.delete("/api/scripts/:id", ctx.requireAuth, (req, res) => {
    deleteScript(req.params.id);
    bumpOpenApiRevision();
    res.json({ success: true });
  });
};
