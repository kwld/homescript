import { Server as HttpServer } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import { getScriptByEndpoint, verifyApiKey, verifyServiceCredentials } from "./db.js";
import { HomeScriptEngine } from "../shared/homescript.js";
import { fetchFromHomeAssistant } from "./ha-client.js";

type WsClientState = {
  authenticated: boolean;
  serviceId?: string;
  serviceName?: string;
  busy: boolean;
};

type WsInboundMessage =
  | { type: "auth"; serviceId?: string; serviceSecret?: string; apiKey?: string }
  | { type: "run"; endpoint: string; variables?: Record<string, any>; requestId?: string }
  | { type: "ping"; requestId?: string };

const wsSend = (ws: WebSocket, payload: Record<string, any>) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
};

const WS_AUTH_WINDOW_MS = 60_000;
const WS_AUTH_MAX_FAILURES_PER_IP = 20;
const wsAuthAttempts = new Map<string, { count: number; resetAt: number }>();

const registerWsAuthFailure = (ip: string) => {
  const now = Date.now();
  const existing = wsAuthAttempts.get(ip);
  if (!existing || existing.resetAt <= now) {
    wsAuthAttempts.set(ip, { count: 1, resetAt: now + WS_AUTH_WINDOW_MS });
    return 1;
  }
  existing.count += 1;
  return existing.count;
};

const isWsIpRateLimited = (ip: string) => {
  const now = Date.now();
  const existing = wsAuthAttempts.get(ip);
  if (!existing) return false;
  if (existing.resetAt <= now) {
    wsAuthAttempts.delete(ip);
    return false;
  }
  return existing.count >= WS_AUTH_MAX_FAILURES_PER_IP;
};

const runScriptOverWs = async (
  endpoint: string,
  variables: Record<string, any>,
  emit: (payload: Record<string, any>) => void
) => {
  const script = getScriptByEndpoint(endpoint);
  if (!script) {
    throw new Error(`Endpoint not found: ${endpoint}`);
  }

  const startedAt = Date.now();
  const engine = new HomeScriptEngine({
    variables,
    onEvent: (event) => {
      emit({
        type: "run_event",
        source: "engine",
        level: event.level || "info",
        message: event.message,
        line: event.line,
        details: event.details || null,
      });
    },
    onCall: async (service, args) => {
      if (process.env.HA_URL && process.env.HA_TOKEN) {
        const [domain, serviceName] = service.split(".");
        if (!domain || !serviceName) {
          throw new Error(`Invalid service format: ${service}`);
        }

        let payload = {};
        if (args.length > 0) {
          if (typeof args[0] === "object") payload = args[0];
          else if (typeof args[0] === "string") payload = { entity_id: args[0] };
        }

        const res = await fetchFromHomeAssistant(`/api/services/${domain}/${serviceName}`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errorText = await res.text();
          emit({
            type: "ha_state",
            action: "call",
            status: "fail",
            service,
            payload,
            error: errorText,
          });
          throw new Error(`Home Assistant Error (${res.status}): ${errorText}`);
        }
        const result: any = await res.json();
        emit({
          type: "ha_state",
          action: "call",
          status: "success",
          service,
          payload,
          value: result,
        });
        return { success: true, ha_response: result };
      }

      emit({
        type: "ha_state",
        action: "call",
        status: "success",
        service,
        payload: args,
        value: { success: true, simulated: true },
      });
      return { success: true, simulated: true };
    },
    onGet: async (entityId) => {
      if (process.env.HA_URL && process.env.HA_TOKEN) {
        const res = await fetchFromHomeAssistant(`/api/states/${entityId}`);
        if (!res.ok) {
          const errorText = await res.text();
          emit({
            type: "ha_state",
            action: "get",
            status: "fail",
            entityId,
            error: errorText,
          });
          throw new Error(`Home Assistant Error (${res.status}): ${errorText}`);
        }
        const result: any = await res.json();
        emit({
          type: "ha_state",
          action: "get",
          status: "success",
          entityId,
          value: result.state,
        });
        return result.state;
      }
      emit({
        type: "ha_state",
        action: "get",
        status: "success",
        entityId,
        value: "mock_state",
      });
      return "mock_state";
    },
    onSet: async (entityId, state) => {
      if (process.env.HA_URL && process.env.HA_TOKEN) {
        const domain = entityId.split(".")[0];
        let serviceDomain = "homeassistant";
        let serviceName = "";
        let payload: any = { entity_id: entityId };

        if (state === "on" || state === true) {
          serviceName = "turn_on";
        } else if (state === "off" || state === false) {
          serviceName = "turn_off";
        } else if (domain === "input_number") {
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
          const res = await fetchFromHomeAssistant(`/api/services/${serviceDomain}/${serviceName}`, {
            method: "POST",
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            const errorText = await res.text();
            emit({
              type: "ha_state",
              action: "set",
              status: "fail",
              entityId,
              service: `${serviceDomain}.${serviceName}`,
              payload,
              error: errorText,
            });
            throw new Error(`Home Assistant Error (${res.status}): ${errorText}`);
          }
          emit({
            type: "ha_state",
            action: "set",
            status: "success",
            entityId,
            service: `${serviceDomain}.${serviceName}`,
            payload,
            value: state,
          });
          return state;
        }

        const res = await fetchFromHomeAssistant(`/api/states/${entityId}`, {
          method: "POST",
          body: JSON.stringify({ state: String(state) }),
        });
        if (!res.ok) {
          const errorText = await res.text();
          emit({
            type: "ha_state",
            action: "set",
            status: "fail",
            entityId,
            payload: { state: String(state) },
            error: errorText,
          });
          throw new Error(`Home Assistant Error (${res.status}): ${errorText}`);
        }
        const result: any = await res.json();
        emit({
          type: "ha_state",
          action: "set",
          status: "success",
          entityId,
          value: result.state,
        });
        return result.state;
      }

      emit({
        type: "ha_state",
        action: "set",
        status: "success",
        entityId,
        value: state,
      });
      return state;
    },
    importCallback: async (name) => {
      const importedScript = getScriptByEndpoint(name);
      if (!importedScript) {
        throw new Error(`Script with endpoint '${name}' not found`);
      }
      return importedScript.code as string;
    },
  });

  const result = await engine.execute(script.code as string);
  return {
    ...result,
    durationMs: Date.now() - startedAt,
  };
};

export const setupServiceWebSocket = (httpServer: HttpServer) => {
  const wsServer = new WebSocketServer({
    server: httpServer,
    path: "/api/ws/service",
  });

  wsServer.on("connection", (ws, req) => {
    const clientIp = req.socket.remoteAddress || "unknown";
    const state: WsClientState = {
      authenticated: false,
      busy: false,
    };

    wsSend(ws, {
      type: "ready",
      message: "Authenticate using {\"type\":\"auth\",\"serviceId\":\"...\",\"serviceSecret\":\"...\"}",
    });

    ws.on("message", async (raw) => {
      let message: WsInboundMessage | null = null;
      try {
        message = JSON.parse(raw.toString()) as WsInboundMessage;
      } catch {
        wsSend(ws, { type: "error", error: "Invalid JSON payload" });
        return;
      }

      if (!message || typeof message !== "object" || !("type" in message)) {
        wsSend(ws, { type: "error", error: "Invalid message format" });
        return;
      }

      if (message.type === "ping") {
        wsSend(ws, { type: "pong", requestId: message.requestId || null });
        return;
      }

      if (message.type === "auth") {
        if (isWsIpRateLimited(clientIp)) {
          wsSend(ws, { type: "auth_error", error: "Too many failed auth attempts. Try again later." });
          ws.close(1013, "Rate limit exceeded");
          return;
        }

        const serviceId = message.serviceId;
        const serviceSecret = message.serviceSecret;
        const apiKey = message.apiKey;

        let account: any = null;
        if (serviceId && serviceSecret) {
          account = verifyServiceCredentials(serviceId, serviceSecret);
        } else if (apiKey) {
          account = verifyApiKey(apiKey);
        }

        if (!account) {
          registerWsAuthFailure(clientIp);
          wsSend(ws, { type: "auth_error", error: "Invalid service credentials" });
          ws.close(1008, "Invalid credentials");
          return;
        }

        state.authenticated = true;
        state.serviceId = account.id;
        state.serviceName = account.name;
        wsSend(ws, {
          type: "auth_ok",
          serviceId: account.id,
          serviceName: account.name,
        });
        return;
      }

      if (message.type === "run") {
        const requestId = message.requestId || uuidv4();
        if (!state.authenticated) {
          wsSend(ws, { type: "run_complete", requestId, success: false, error: "Not authenticated" });
          return;
        }
        if (state.busy) {
          wsSend(ws, { type: "run_complete", requestId, success: false, error: "Another run is already in progress" });
          return;
        }
        if (!message.endpoint || typeof message.endpoint !== "string") {
          wsSend(ws, { type: "run_complete", requestId, success: false, error: "Missing endpoint" });
          return;
        }

        const runStartedAt = Date.now();
        state.busy = true;
        wsSend(ws, {
          type: "run_started",
          requestId,
          endpoint: message.endpoint,
          startedAt: new Date(runStartedAt).toISOString(),
        });

        try {
          const variables = message.variables && typeof message.variables === "object" ? message.variables : {};
          const result = await runScriptOverWs(message.endpoint, variables, (payload) => {
            wsSend(ws, {
              ...payload,
              requestId,
              endpoint: message.endpoint,
              timestamp: new Date().toISOString(),
            });
          });

          wsSend(ws, {
            type: "run_complete",
            requestId,
            endpoint: message.endpoint,
            success: true,
            output: result.output,
            variables: result.variables,
            durationMs: result.durationMs,
            finishedAt: new Date().toISOString(),
          });
        } catch (error: any) {
          wsSend(ws, {
            type: "run_complete",
            requestId,
            endpoint: message.endpoint,
            success: false,
            error: error?.message || "Execution failed",
            line: error?.line,
            durationMs: Date.now() - runStartedAt,
            finishedAt: new Date().toISOString(),
          });
        } finally {
          state.busy = false;
        }
      }
    });
  });
};
