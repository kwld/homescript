import { Express } from "express";
import { RouteContext } from "../types.js";
import { fetchFromHomeAssistant } from "../../ha-client.js";

export const registerHaRoutes = (app: Express, ctx: RouteContext) => {
  app.get("/api/states", ctx.requireAuth, async (_req, res) => {
    if (process.env.HA_URL && process.env.HA_TOKEN) {
      try {
        const haRes = await fetchFromHomeAssistant("/api/states");
        if (!haRes.ok) {
          console.error(`Failed to fetch states from Home Assistant: HTTP ${haRes.status} ${haRes.statusText}`);
          return res.json([]);
        }
        const states = await haRes.json();
        return res.json(states);
      } catch (e: any) {
        console.error(e.message || "Error connecting to Home Assistant");
        return res.json([]);
      }
    }
    res.json([]);
  });

  app.get("/api/services", ctx.requireAuth, async (_req, res) => {
    if (process.env.HA_URL && process.env.HA_TOKEN) {
      try {
        const haRes = await fetchFromHomeAssistant("/api/services");
        if (!haRes.ok) {
          console.error(`Failed to fetch services from Home Assistant: HTTP ${haRes.status} ${haRes.statusText}`);
        } else {
          const services = await haRes.json();
          return res.json(services);
        }
      } catch (e: any) {
        console.error(e.message || "Error connecting to Home Assistant");
      }
    }

    if (!ctx.USE_MOCKS) {
      return res.json([]);
    }

    const services = [
      { domain: "homeassistant", services: { turn_on: { name: "Turn on" }, turn_off: { name: "Turn off" }, toggle: { name: "Toggle" } } },
      { domain: "light", services: { turn_on: { name: "Turn on" }, turn_off: { name: "Turn off" }, toggle: { name: "Toggle" } } },
      { domain: "switch", services: { turn_on: { name: "Turn on" }, turn_off: { name: "Turn off" }, toggle: { name: "Toggle" } } },
    ];
    res.json(services);
  });

  app.post("/api/call_service", ctx.requireAuth, async (req, res) => {
    if (process.env.HA_URL && process.env.HA_TOKEN) {
      try {
        const { domain, service, serviceData } = req.body;
        const haRes = await fetchFromHomeAssistant(`/api/services/${domain}/${service}`, {
          method: "POST",
          body: JSON.stringify(serviceData || {}),
        });
        if (!haRes.ok) {
          const errorText = await haRes.text();
          return res.status(haRes.status).json({ error: errorText });
        }
        const result = await haRes.json();
        return res.json(result);
      } catch (e: any) {
        return res.status(502).json({ error: e.message || "Failed to connect to Home Assistant" });
      }
    }

    if (!ctx.USE_MOCKS) {
      return res.status(500).json({ error: "Home Assistant is not configured on the server" });
    }

    res.json([{ success: true, mock: true }]);
  });
};
