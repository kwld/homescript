import { Express } from "express";
import { RouteContext } from "../types.js";

export const registerConfigRoutes = (app: Express, ctx: RouteContext) => {
  app.get("/api/config", (_req, res) => {
    res.json({ mock: ctx.USE_MOCKS });
  });
};
