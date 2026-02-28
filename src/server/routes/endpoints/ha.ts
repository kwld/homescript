import { Express } from "express";
import { RouteContext } from "../types.js";
import { fetchFromHomeAssistant } from "../../ha-client.js";

export const registerHaRoutes = (app: Express, ctx: RouteContext) => {
  app.get("/api/history", ctx.requireAuth, async (req, res) => {
    const entityId = String(req.query.entityId || "").trim();
    const hours = Number(req.query.hours || 24);
    const maxHours = 24 * 14;
    const safeHours = Number.isFinite(hours) ? Math.min(Math.max(hours, 1), maxHours) : 24;

    if (!entityId) {
      return res.status(400).json({ error: "entityId query param is required" });
    }

    if (!process.env.HA_URL || !process.env.HA_TOKEN) {
      return res.json({ entityId, points: [] });
    }

    const start = new Date(Date.now() - safeHours * 60 * 60 * 1000).toISOString();
    const query = new URLSearchParams({
      filter_entity_id: entityId,
      minimal_response: "",
      no_attributes: "",
    });

    try {
      const historyRes = await fetchFromHomeAssistant(`/api/history/period/${encodeURIComponent(start)}?${query.toString()}`);
      if (!historyRes.ok) {
        const errorText = await historyRes.text();
        return res.status(historyRes.status).json({ error: errorText });
      }

      const payload: any = await historyRes.json();
      const series = Array.isArray(payload) && Array.isArray(payload[0]) ? payload[0] : [];
      const states = Array.from(
        new Set(
          series
            .map((item: any) => (item?.state === undefined || item?.state === null ? null : String(item.state)))
            .filter((v: string | null): v is string => Boolean(v && v.trim().length > 0)),
        ),
      );

      const points = series
        .map((item: any) => {
          const stateRaw = item?.state;
          const ts = item?.last_changed || item?.last_updated;
          if (!ts || stateRaw === undefined || stateRaw === null) return null;

          let numericValue: number | null = Number(stateRaw);
          if (!Number.isFinite(numericValue)) {
            if (stateRaw === "on") numericValue = 1;
            else if (stateRaw === "off") numericValue = 0;
            else numericValue = null;
          }
          if (numericValue === null) return null;

          return {
            ts,
            value: Number(numericValue),
            state: stateRaw,
          };
        })
        .filter(Boolean);

      res.json({
        entityId,
        hours: safeHours,
        points,
        states,
      });
    } catch (e: any) {
      res.status(502).json({ error: e.message || "Failed to fetch history from Home Assistant" });
    }
  });

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
