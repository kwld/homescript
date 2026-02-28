import { Express } from "express";
import { RouteContext } from "../types.js";
import { getScriptByEndpoint } from "../../db.js";
import { HomeScriptEngine } from "../../../shared/homescript.js";

export const registerWebhookRoutes = (app: Express, _ctx: RouteContext) => {
  app.post("/api/webhook/:endpoint", async (req, res) => {
    const script = getScriptByEndpoint(req.params.endpoint);
    if (!script) return res.status(404).json({ error: "Endpoint not found" });

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
