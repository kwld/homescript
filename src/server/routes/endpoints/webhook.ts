import { Express } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { RouteContext } from "../types.js";
import { getScriptByEndpoint } from "../../db.js";
import { HomeScriptEngine } from "../../../shared/homescript.js";
import { createRateLimit } from "../rate-limit.js";

const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

const getWebhookSecret = (triggerConfigRaw: unknown): string | null => {
  if (typeof triggerConfigRaw === "string") {
    try {
      const parsed = JSON.parse(triggerConfigRaw);
      if (parsed && typeof parsed.webhookSecret === "string" && parsed.webhookSecret.trim()) {
        return parsed.webhookSecret.trim();
      }
    } catch {
      // ignore invalid trigger config JSON and use env fallback
    }
  }

  const envSecret = process.env.WEBHOOK_SIGNING_SECRET;
  if (envSecret && envSecret.trim()) {
    return envSecret.trim();
  }
  return null;
};

const isValidHex = (value: string) => /^[0-9a-fA-F]+$/.test(value);

const verifyWebhookSignature = (req: any, secret: string): string | null => {
  const timestampHeader = req.headers["x-webhook-timestamp"];
  const signatureHeader = req.headers["x-webhook-signature"];

  if (typeof timestampHeader !== "string" || typeof signatureHeader !== "string") {
    return "Missing webhook signature headers";
  }

  const timestampMs = Number(timestampHeader);
  if (!Number.isFinite(timestampMs)) {
    return "Invalid webhook timestamp";
  }

  const now = Date.now();
  if (Math.abs(now - timestampMs) > WEBHOOK_TIMESTAMP_TOLERANCE_MS) {
    return "Webhook timestamp outside allowed window";
  }

  const rawBody = typeof req.rawBody === "string" ? req.rawBody : JSON.stringify(req.body || {});
  const expectedHex = createHmac("sha256", secret).update(`${timestampHeader}.${rawBody}`).digest("hex");
  const providedHex = signatureHeader.startsWith("sha256=")
    ? signatureHeader.substring("sha256=".length)
    : signatureHeader;

  if (!isValidHex(providedHex)) {
    return "Invalid signature format";
  }

  const expected = Buffer.from(expectedHex, "hex");
  const provided = Buffer.from(providedHex, "hex");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return "Invalid webhook signature";
  }

  return null;
};

export const registerWebhookRoutes = (app: Express, _ctx: RouteContext) => {
  const webhookRateLimit = createRateLimit({
    maxRequests: 120,
    windowMs: 60_000,
    key: (req) => `${req.ip}:webhook:${req.params.endpoint}`,
    errorMessage: "Too many webhook requests",
  });

  app.post("/api/webhook/:endpoint", webhookRateLimit, async (req, res) => {
    const script = getScriptByEndpoint(req.params.endpoint);
    if (!script) return res.status(404).json({ error: "Endpoint not found" });

    const secret = getWebhookSecret((script as any).trigger_config);
    if (!secret) {
      return res.status(401).json({ error: "Webhook secret is not configured for this endpoint" });
    }

    const verificationError = verifyWebhookSignature(req, secret);
    if (verificationError) {
      return res.status(401).json({ error: verificationError });
    }

    const variables = {
      ...req.query,
      webhook_data: req.body,
      webhook_query: req.query,
    };

    const engine = new HomeScriptEngine({
      variables,
      onCall: async (service, args) => {
        if (process.env.HA_URL && process.env.HA_TOKEN) {
          const [domain, serviceName] = service.split(".");
          if (!domain || !serviceName) throw new Error(`Invalid service format: ${service}`);

          let payload = {};
          if (args.length > 0) {
            if (typeof args[0] === "object") payload = args[0];
            else if (typeof args[0] === "string") payload = { entity_id: args[0] };
          }

          try {
            const haRes = await fetch(`${process.env.HA_URL}/api/services/${domain}/${serviceName}`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${process.env.HA_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
            });
            if (!haRes.ok) {
              const errText = await haRes.text();
              throw new Error(`Home Assistant Error (${haRes.status}): ${errText}`);
            }
            const result: any = await haRes.json();
            return { success: true, ha_response: result };
          } catch (e: any) {
            throw new Error(`Failed to call Home Assistant: ${e.message}`);
          }
        }

        console.log(`[Server] Calling HA service ${service} with args`, args);
        return { success: true, simulated: true };
      },
      onGet: async (entityId) => {
        if (process.env.HA_URL && process.env.HA_TOKEN) {
          try {
            const haRes = await fetch(`${process.env.HA_URL}/api/states/${entityId}`, {
              headers: {
                "Authorization": `Bearer ${process.env.HA_TOKEN}`,
                "Content-Type": "application/json",
              },
            });

            if (!haRes.ok) {
              const errText = await haRes.text();
              throw new Error(`Home Assistant Error (${haRes.status}): ${errText}`);
            }

            const result: any = await haRes.json();
            return result.state;
          } catch (e: any) {
            throw new Error(`Failed to get state from Home Assistant: ${e.message}`);
          }
        }
        console.log(`[Server] Getting HA state for ${entityId}`);
        return "mock_state";
      },
      onSet: async (entityId, state) => {
        if (process.env.HA_URL && process.env.HA_TOKEN) {
          try {
            const domain = entityId.split(".")[0];
            let serviceDomain = "homeassistant";
            let serviceName = "";
            let payload: any = { entity_id: entityId };

            if (state === "on" || state === true) serviceName = "turn_on";
            else if (state === "off" || state === false) serviceName = "turn_off";
            else if (domain === "input_number") {
              serviceDomain = "input_number";
              serviceName = "set_value";
              payload.value = Number(state);
            } else if (domain === "input_select") {
              serviceDomain = "input_select";
              serviceName = "select_option";
              payload.option = String(state);
            } else if (domain === "input_text") {
              serviceDomain = "input_text";
              serviceName = "set_value";
              payload.value = String(state);
            } else if (domain === "input_boolean") {
              serviceDomain = "input_boolean";
              serviceName = state ? "turn_on" : "turn_off";
            }

            if (serviceName) {
              const haRes = await fetch(`${process.env.HA_URL}/api/services/${serviceDomain}/${serviceName}`, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${process.env.HA_TOKEN}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
              });
              if (!haRes.ok) {
                const errText = await haRes.text();
                throw new Error(`Home Assistant Error (${haRes.status}): ${errText}`);
              }
              return state;
            }

            const haRes = await fetch(`${process.env.HA_URL}/api/states/${entityId}`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${process.env.HA_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ state: String(state) }),
            });
            if (!haRes.ok) {
              const errText = await haRes.text();
              throw new Error(`Home Assistant Error (${haRes.status}): ${errText}`);
            }
            const result: any = await haRes.json();
            return result.state;
          } catch (e: any) {
            throw new Error(`Failed to set state in Home Assistant: ${e.message}`);
          }
        }
        console.log(`[Server] Setting HA state for ${entityId} to ${state}`);
        return state;
      },
      importCallback: async (name: string) => {
        const importedScript = getScriptByEndpoint(name);
        if (!importedScript) throw new Error(`Script with endpoint '${name}' not found`);
        return importedScript.code as string;
      },
    });

    try {
      const result = await engine.execute(script.code as string);
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e.message, line: e.line });
    }
  });
};
