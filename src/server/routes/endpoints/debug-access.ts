import { Express } from "express";
import { RouteContext } from "../types.js";
import { getDebugAccessSettings, getScriptByEndpoint, getScriptsWithTriggerConfigs, updateDebugAccessSettings } from "../../db.js";
import { isValidIpOrCidr } from "../../ip-whitelist.js";
import { isIpAllowedByWhitelist, normalizeRequestIp } from "../../ip-whitelist.js";
import { HomeScriptEngine } from "../../../shared/homescript.js";

type ScriptDecl = {
  required: string[];
  optional: Array<{ name: string; defaultRaw: string | null }>;
};

const getEffectiveDebugCode = (scriptRow: any) => {
  const debugCode = typeof scriptRow?.debug_code === "string" ? scriptRow.debug_code.trim() : "";
  if (debugCode.length > 0) return String(scriptRow.debug_code);
  return String(scriptRow?.code || "");
};

const parseRequiredOptionalFromCode = (code: string): ScriptDecl => {
  const required: string[] = [];
  const optional: Array<{ name: string; defaultRaw: string | null }> = [];
  const lines = String(code || "").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const req = line.match(/^REQUIRED\s+\$([a-zA-Z0-9_]+)(?:\s+IF\s*\([\s\S]+\))?$/);
    if (req) {
      required.push(req[1]);
      continue;
    }

    const opt = line.match(/^OPTIONAL\s+\$([a-zA-Z0-9_]+)(?:\s*=\s*(.+?))?(?:\s+IF\s*\([\s\S]+\))?$/);
    if (opt) {
      optional.push({ name: opt[1], defaultRaw: opt[2]?.trim() || null });
      continue;
    }

    break;
  }
  return { required, optional };
};

const normalizeDefault = (raw: string | null) => {
  if (!raw) return null;
  if (/^"[\s\S]*"$/.test(raw)) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (/^(true|false)$/i.test(raw)) return /^true$/i.test(raw);
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
};

const collectExecutableLineNumbers = (code: string) =>
  String(code || "")
    .split("\n")
    .map((raw, idx) => ({ line: idx + 1, content: raw.trim() }))
    .filter((x) => x.content.length > 0 && !x.content.startsWith("#"))
    .map((x) => x.line);

type LiveDebugSession = {
  sessionId: string;
  endpoint: string;
  createdAt: string;
  payload: any;
};

const liveDebugSessions = new Map<string, LiveDebugSession>();
let liveDebugSeq = 0;

const saveLiveDebugSession = (endpoint: string, payload: any) => {
  liveDebugSeq += 1;
  const session: LiveDebugSession = {
    sessionId: `dbg-${Date.now()}-${liveDebugSeq}`,
    endpoint,
    createdAt: new Date().toISOString(),
    payload,
  };
  liveDebugSessions.set(endpoint, session);
  return session;
};

export const registerDebugAccessRoutes = (app: Express, ctx: RouteContext) => {
  const assertPublicDebugAllowed = (req: any, res: any) => {
    const settings = getDebugAccessSettings();
    if (!settings.enabled) {
      res.json({ enabled: false, endpoints: [] });
      return false;
    }
    const reqIp = normalizeRequestIp(String(req.ip || ""));
    if (!isIpAllowedByWhitelist(reqIp, settings.whitelist)) {
      res.status(403).json({ enabled: true, error: "Debug mode enabled but your IP is not whitelisted" });
      return false;
    }
    return true;
  };

  app.get("/api/debug-access/public", (req, res) => {
    if (!assertPublicDebugAllowed(req, res)) return;
    const settings = getDebugAccessSettings();

    const scripts = (getScriptsWithTriggerConfigs() as any[]).map((s) => {
      const effectiveCode = getEffectiveDebugCode(s);
      const decl = parseRequiredOptionalFromCode(effectiveCode);
      const prebuiltInput: Record<string, any> = {};
      decl.required.forEach((name) => {
        prebuiltInput[name] = "";
      });
      decl.optional.forEach((item) => {
        prebuiltInput[item.name] = normalizeDefault(item.defaultRaw);
      });
      return {
        id: s.id,
        name: s.name || s.endpoint,
        endpoint: s.endpoint,
        source: effectiveCode === String(s.code || "") ? "main" : "debug",
        required: decl.required,
        optional: decl.optional,
        prebuiltInput,
      };
    });

    return res.json({
      enabled: true,
      whitelistCount: settings.whitelist.length,
      endpoints: scripts,
    });
  });

  app.post("/api/debug-access/run/:endpoint", async (req, res) => {
    if (!assertPublicDebugAllowed(req, res)) return;
    const script = getScriptByEndpoint(req.params.endpoint) as any;
    if (!script) return res.status(404).json({ error: "Endpoint not found" });

    const inputsRaw = req.body?.inputs;
    const mockStatesRaw = req.body?.mockStates;
    const debugOptionsRaw = req.body?.debugOptions;
    const inputs = inputsRaw && typeof inputsRaw === "object" && !Array.isArray(inputsRaw) ? { ...inputsRaw } : {};
    const mockStates = mockStatesRaw && typeof mockStatesRaw === "object" && !Array.isArray(mockStatesRaw) ? { ...mockStatesRaw } : {};
    const debugOptions = debugOptionsRaw && typeof debugOptionsRaw === "object" && !Array.isArray(debugOptionsRaw) ? debugOptionsRaw : {};
    const serviceCalls: Array<{ service: string; args: any[] }> = [];
    const breakpointHits: number[] = [];
    const traceEvents: Array<{ type: string; line?: number; message: string; level?: string }> = [];
    const effectiveCode = getEffectiveDebugCode(script);
    const highlightAll = Boolean((debugOptions as any).highlightAllLines);
    const requestedDelay = Number((debugOptions as any).lineDelayMs);
    const lineDelayMs = Number.isFinite(requestedDelay) ? Math.max(0, Math.min(5000, requestedDelay)) : 180;
    const breakpointsRaw = Array.isArray((debugOptions as any).breakpoints) ? (debugOptions as any).breakpoints : [];
    const requestedBreakpoints = breakpointsRaw
      .map((v: any) => Number(v))
      .filter((v: number) => Number.isInteger(v) && v > 0);
    const effectiveBreakpoints: number[] = Array.from(
      new Set(highlightAll ? [...requestedBreakpoints, ...collectExecutableLineNumbers(effectiveCode)] : requestedBreakpoints),
    );

    const engine = new HomeScriptEngine({
      variables: {
        ...inputs,
        DEBUG: {
          mode: "public",
          mockServiceObject: true,
        },
      },
      queryParams: inputs,
      debug: true,
      breakpoints: effectiveBreakpoints,
      onBreakpoint: async (line) => {
        breakpointHits.push(line);
        if (lineDelayMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, lineDelayMs));
        }
        return "CONTINUE";
      },
      onEvent: (event) => {
        traceEvents.push({
          type: String(event.type || ""),
          line: typeof event.line === "number" ? event.line : undefined,
          message: String(event.message || ""),
          level: event.level ? String(event.level) : undefined,
        });
      },
      onCall: async (service, args) => {
        serviceCalls.push({ service, args });
        return { success: true, mock: true, service, args };
      },
      onGet: async (entityId) => {
        if (Object.prototype.hasOwnProperty.call(mockStates, entityId)) {
          return (mockStates as any)[entityId];
        }
        return "unknown";
      },
      onSet: async (entityId, state) => {
        (mockStates as any)[entityId] = state;
        return state;
      },
      importCallback: async (name: string) => {
        const imported = getScriptByEndpoint(name) as any;
        if (!imported) throw new Error(`Script '${name}' not found`);
        return String(imported.code || "");
      },
    });

    try {
      const result = await engine.execute(effectiveCode);
      const responsePayload = {
        output: result.output,
        variables: result.variables,
        source: effectiveCode === String(script.code || "") ? "main" : "debug",
        effectiveCode,
        lineDelayMs,
        requestedBreakpoints,
        breakpoints: effectiveBreakpoints,
        breakpointHits,
        traceEvents,
        serviceCalls,
        mockStates,
      };
      const session = saveLiveDebugSession(req.params.endpoint, {
        success: true,
        ...responsePayload,
      });
      return res.json({ ...responsePayload, sessionId: session.sessionId, createdAt: session.createdAt });
    } catch (e: any) {
      const statusCode = typeof e?.statusCode === "number" ? e.statusCode : 400;
      const responsePayload = {
        error: e?.message || "Execution failed",
        line: e?.line,
        source: effectiveCode === String(script.code || "") ? "main" : "debug",
        effectiveCode,
        lineDelayMs,
        requestedBreakpoints,
        breakpoints: effectiveBreakpoints,
        breakpointHits,
        traceEvents,
        serviceCalls,
        mockStates,
      };
      const session = saveLiveDebugSession(req.params.endpoint, {
        success: false,
        ...responsePayload,
      });
      return res.status(statusCode).json({ ...responsePayload, sessionId: session.sessionId, createdAt: session.createdAt });
    }
  });

  app.get("/api/debug-access/live/:endpoint", ctx.requireAuth, (req, res) => {
    if (!(req as any).user) {
      return res.status(403).json({ error: "Only admin UI users can read live debug sessions" });
    }
    const session = liveDebugSessions.get(req.params.endpoint);
    if (!session) return res.json({ sessionId: null, endpoint: req.params.endpoint });
    return res.json(session);
  });

  app.get("/api/debug-access", ctx.requireAuth, (req, res) => {
    if (!(req as any).user) {
      return res.status(403).json({ error: "Only admin UI users can read debug access settings" });
    }
    return res.json(getDebugAccessSettings());
  });

  app.put("/api/debug-access", ctx.requireAuth, (req, res) => {
    if (!(req as any).user) {
      return res.status(403).json({ error: "Only admin UI users can update debug access settings" });
    }
    const enabled = Boolean(req.body?.enabled);
    const whitelistRaw = req.body?.whitelist;
    if (!Array.isArray(whitelistRaw)) {
      return res.status(400).json({ error: "whitelist must be an array of IP/CIDR strings" });
    }
    const whitelist = whitelistRaw
      .map((v: unknown) => String(v || "").trim())
      .filter(Boolean);

    const invalid = whitelist.filter((entry) => !isValidIpOrCidr(entry));
    if (invalid.length > 0) {
      return res.status(400).json({ error: "Invalid IP/CIDR entries", invalid });
    }
    if (enabled && whitelist.length === 0) {
      return res.status(400).json({ error: "Whitelist cannot be empty when debug bypass is enabled" });
    }

    return res.json(updateDebugAccessSettings(enabled, whitelist));
  });

  app.get("/api/debug-access/status", ctx.requireAuth, (req, res) => {
    if (!(req as any).user) {
      return res.status(403).json({ error: "Only admin UI users can read debug status" });
    }
    const settings = getDebugAccessSettings();
    return res.json({
      enabled: settings.enabled,
      whitelistCount: settings.whitelist.length,
      updatedAt: settings.updatedAt,
    });
  });
};
