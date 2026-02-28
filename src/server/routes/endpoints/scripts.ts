import { Express } from "express";
import { v4 as uuidv4 } from "uuid";
import { RouteContext } from "../types.js";
import {
  createScript,
  deleteScript,
  getScriptById,
  getScripts,
  updateScript,
} from "../../db.js";

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
    const { name, code, endpoint, testParams } = req.body;
    if (!name || !code || !endpoint) return res.status(400).json({ error: "Missing fields" });

    const id = uuidv4();
    try {
      createScript(id, name, code, endpoint, testParams || "{}");
      res.json({ id, name, code, endpoint, testParams: testParams || "{}" });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put("/api/scripts/:id", ctx.requireAuth, (req, res) => {
    const { name, code, endpoint, testParams } = req.body;
    if (!name || !code || !endpoint) return res.status(400).json({ error: "Missing fields" });

    try {
      updateScript(req.params.id, name, code, endpoint, testParams || "{}");
      res.json({ id: req.params.id, name, code, endpoint, testParams: testParams || "{}" });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/scripts/:id", ctx.requireAuth, (req, res) => {
    deleteScript(req.params.id);
    res.json({ success: true });
  });
};
