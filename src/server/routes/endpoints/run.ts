import { Express } from "express";
import { v4 as uuidv4 } from "uuid";
import { RouteContext } from "../types.js";
import { getScriptByEndpoint } from "../../db.js";
import { HomeScriptEngine, HomeScriptTraceEvent } from "../../../shared/homescript.js";
import { ExecutionEvent, ExecutionReport, HAStateEvent } from "../../../shared/execution-report.js";
import { createRateLimit } from "../rate-limit.js";
import { createRunDebugAccessMiddleware } from "../run-debug-access.js";

export const registerRunRoutes = (app: Express, ctx: RouteContext) => {
  const debugAccessMiddleware = createRunDebugAccessMiddleware();
  const runRateLimit = createRateLimit({
    maxRequests: 60,
    windowMs: 60_000,
    key: (req) =>
      `${req.ip}:run:${(req as any).serviceAccount?.id || (req as any).user?.id || "anon"}:${req.params.endpoint}`,
    errorMessage: "Too many execution requests",
  });

  const handleRun = async (req: any, res: any, source: "get" | "post") => {
    const script = getScriptByEndpoint(req.params.endpoint);
    if (!script) return res.status(404).json({ error: "Endpoint not found" });

    const variables = source === "get" ? { ...req.query } : { ...(req.body || {}) };
    const startedAt = Date.now();
    const requestId = uuidv4();
    const events: ExecutionEvent[] = [];
    const haStates: HAStateEvent[] = [];
    const authMode: "jwt" | "service_key" | "debug_bypass" | "mock" | "unknown" =
      (req as any).debugBypassAuth ? "debug_bypass" :
      (req as any).serviceAccount ? "service_key" :
      (req as any).user?.id === "admin" && ctx.USE_MOCKS ? "mock" :
      (req as any).user ? "jwt" : "unknown";
    const haMode: "real" | "mock" = process.env.HA_URL && process.env.HA_TOKEN ? "real" : "mock";

    const logEvent = (event: Omit<ExecutionEvent, "id" | "timestamp">) => {
      events.push({ id: uuidv4(), timestamp: new Date().toISOString(), ...event });
    };

    const mapEngineLevel = (level?: HomeScriptTraceEvent["level"]): ExecutionEvent["level"] => {
      if (level === "error") return "error";
      if (level === "success") return "success";
      if (level === "warning") return "warning";
      return "info";
    };

    const engine = new HomeScriptEngine({
      variables,
      queryParams: req.query as Record<string, any>,
      onEvent: (event) => {
        logEvent({
          source: "engine",
          level: mapEngineLevel(event.level),
          message: event.message,
          line: event.line,
          details: event.details,
        });
      },
      onCall: async (service, args) => {
        const callStart = Date.now();
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
              haStates.push({ timestamp: new Date().toISOString(), action: "call", status: "fail", service, payload, error: errText });
              logEvent({
                source: "ha",
                level: "error",
                message: `HA CALL failed: ${service}`,
                details: { payload, error: errText, durationMs: Date.now() - callStart },
              });
              throw new Error(`Home Assistant Error (${haRes.status}): ${errText}`);
            }

            const result: any = await haRes.json();
            haStates.push({ timestamp: new Date().toISOString(), action: "call", status: "success", service, payload, value: result });
            logEvent({
              source: "ha",
              level: "success",
              message: `HA CALL success: ${service}`,
              details: { payload, durationMs: Date.now() - callStart },
            });
            return { success: true, ha_response: result };
          } catch (e: any) {
            throw new Error(`Failed to call Home Assistant: ${e.message}`);
          }
        }

        console.log(`[Server] Calling HA service ${service} with args`, args);
        haStates.push({
          timestamp: new Date().toISOString(),
          action: "call",
          status: "success",
          service,
          payload: args,
          value: { success: true, simulated: true },
        });
        logEvent({
          source: "ha",
          level: "success",
          message: `Mock HA CALL: ${service}`,
          details: { args, durationMs: Date.now() - callStart },
        });
        return { success: true, simulated: true };
      },
      onGet: async (entityId) => {
        const getStart = Date.now();
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
              haStates.push({ timestamp: new Date().toISOString(), action: "get", status: "fail", entityId, error: errText });
              logEvent({
                source: "ha",
                level: "error",
                message: `HA GET failed: ${entityId}`,
                details: { error: errText, durationMs: Date.now() - getStart },
              });
              throw new Error(`Home Assistant Error (${haRes.status}): ${errText}`);
            }

            const result: any = await haRes.json();
            haStates.push({ timestamp: new Date().toISOString(), action: "get", status: "success", entityId, value: result.state });
            logEvent({
              source: "ha",
              level: "success",
              message: `HA GET success: ${entityId}`,
              details: { value: result.state, durationMs: Date.now() - getStart },
            });
            return result.state;
          } catch (e: any) {
            throw new Error(`Failed to get state from Home Assistant: ${e.message}`);
          }
        }
        console.log(`[Server] Getting HA state for ${entityId}`);
        haStates.push({ timestamp: new Date().toISOString(), action: "get", status: "success", entityId, value: "mock_state" });
        logEvent({
          source: "ha",
          level: "success",
          message: `Mock HA GET: ${entityId}`,
          details: { durationMs: Date.now() - getStart },
        });
        return "mock_state";
      },
      onSet: async (entityId, state) => {
        const setStart = Date.now();
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
                haStates.push({
                  timestamp: new Date().toISOString(),
                  action: "set",
                  status: "fail",
                  entityId,
                  service: `${serviceDomain}.${serviceName}`,
                  payload,
                  error: errText,
                });
                logEvent({
                  source: "ha",
                  level: "error",
                  message: `HA SET failed: ${entityId}`,
                  details: { payload, error: errText, durationMs: Date.now() - setStart },
                });
                throw new Error(`Home Assistant Error (${haRes.status}): ${errText}`);
              }
              haStates.push({
                timestamp: new Date().toISOString(),
                action: "set",
                status: "success",
                entityId,
                service: `${serviceDomain}.${serviceName}`,
                payload,
                value: state,
              });
              logEvent({
                source: "ha",
                level: "success",
                message: `HA SET success: ${entityId}`,
                details: { payload, durationMs: Date.now() - setStart },
              });
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
              haStates.push({
                timestamp: new Date().toISOString(),
                action: "set",
                status: "fail",
                entityId,
                payload: { state: String(state) },
                error: errText,
              });
              logEvent({
                source: "ha",
                level: "error",
                message: `HA SET failed: ${entityId}`,
                details: { error: errText, durationMs: Date.now() - setStart },
              });
              throw new Error(`Home Assistant Error (${haRes.status}): ${errText}`);
            }

            const result: any = await haRes.json();
            haStates.push({ timestamp: new Date().toISOString(), action: "set", status: "success", entityId, value: result.state });
            logEvent({
              source: "ha",
              level: "success",
              message: `HA SET success: ${entityId}`,
              details: { value: result.state, durationMs: Date.now() - setStart },
            });
            return result.state;
          } catch (e: any) {
            throw new Error(`Failed to set state in Home Assistant: ${e.message}`);
          }
        }

        console.log(`[Server] Setting HA state for ${entityId} to ${state}`);
        haStates.push({ timestamp: new Date().toISOString(), action: "set", status: "success", entityId, value: state });
        logEvent({
          source: "ha",
          level: "success",
          message: `Mock HA SET: ${entityId}`,
          details: { value: state, durationMs: Date.now() - setStart },
        });
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
      const report: ExecutionReport = {
        schemaVersion: 1,
        success: true,
        durationMs: Date.now() - startedAt,
        output: result.output,
        variables: result.variables,
        events,
        haStates,
        meta: {
          requestId,
          endpoint: req.params.endpoint,
          authMode,
          haMode,
          durationMs: Date.now() - startedAt,
          httpStatus: 200,
        },
      };
      res.json({ ...result, report });
    } catch (e: any) {
      const statusCode = typeof e?.statusCode === "number" ? e.statusCode : 400;
      logEvent({
        source: "backend",
        level: "error",
        message: e.message || "Execution failed",
        line: e.line,
      });
      const report: ExecutionReport = {
        schemaVersion: 1,
        success: false,
        durationMs: Date.now() - startedAt,
        output: [],
        variables: {},
        events,
        haStates,
        error: { message: e.message, line: e.line },
        meta: {
          requestId,
          endpoint: req.params.endpoint,
          authMode,
          haMode,
          durationMs: Date.now() - startedAt,
          httpStatus: statusCode,
        },
      };
      res.status(statusCode).json({ error: e.message, line: e.line, report });
    }
  };

  app.get("/api/run/:endpoint", debugAccessMiddleware, ctx.requireAuth, runRateLimit, async (req, res) => {
    await handleRun(req, res, "get");
  });

  app.post("/api/run/:endpoint", debugAccessMiddleware, ctx.requireAuth, runRateLimit, async (req, res) => {
    await handleRun(req, res, "post");
  });
};
