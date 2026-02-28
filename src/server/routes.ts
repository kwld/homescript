import { Express, Request, Response as ExpressResponse } from "express";
import { v4 as uuidv4 } from "uuid";
import jwt from "jsonwebtoken";
import {
  getServiceAccounts,
  createServiceAccount,
  deleteServiceAccount,
  getScripts,
  getScriptById,
  getScriptByEndpoint,
  createScript,
  updateScript,
  deleteScript,
  verifyApiKey,
  verifyServiceCredentials
} from "./db.js";
import { HomeScriptEngine, HomeScriptTraceEvent } from "../shared/homescript.js";
import { ExecutionEvent, ExecutionReport, HAStateEvent } from "../shared/execution-report.js";

const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-for-dev";
const USE_MOCKS = process.env.MOCK !== 'disabled';
const HA_TIMEOUT_MS = Number(process.env.HA_TIMEOUT_MS || 8000);

const getAuthentikBaseUrl = () => {
  if (process.env.AUTHENTIK_URL) return process.env.AUTHENTIK_URL;
  if (process.env.AUTHENTIK_ISSUER) {
    try {
      return new URL(process.env.AUTHENTIK_ISSUER).origin;
    } catch (e) {
      return null;
    }
  }
  return null;
};

const normalizeHaError = (error: unknown, url: string): string => {
  const err = error as any;

  if (err?.name === "AbortError") {
    return `Home Assistant request timed out after ${HA_TIMEOUT_MS}ms (${url})`;
  }

  const causeCode = err?.cause?.code;
  if (causeCode === "ETIMEDOUT") {
    return `Home Assistant connection timed out (${url})`;
  }
  if (causeCode === "ECONNREFUSED") {
    return `Home Assistant connection refused (${url})`;
  }
  if (causeCode === "ENOTFOUND") {
    return `Home Assistant host not found (${url})`;
  }

  if (typeof err?.message === "string" && err.message.length > 0) {
    return `Home Assistant request failed: ${err.message}`;
  }
  return "Home Assistant request failed";
};

const fetchFromHomeAssistant = async (path: string, init: RequestInit = {}): Promise<Response> => {
  if (!process.env.HA_URL || !process.env.HA_TOKEN) {
    throw new Error("Home Assistant is not configured on the server");
  }

  const url = `${process.env.HA_URL}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HA_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      headers: {
        "Authorization": `Bearer ${process.env.HA_TOKEN}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(normalizeHaError(error, url));
  } finally {
    clearTimeout(timeout);
  }
};

export function setupRoutes(app: Express) {
  // --- Auth Middleware ---
  const requireAuth = (req: Request, res: ExpressResponse, next: Function) => {
    // Check for Bearer token
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      if (USE_MOCKS && token === 'mock-admin-token') {
        (req as any).user = { id: "admin", name: "Administrator" };
        return next();
      }
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        (req as any).user = decoded;
        return next();
      } catch (e) {
        // ignore
      }
    }
    // Check for service account
    const serviceIdHeader = req.headers['x-service-id'];
    const serviceSecretHeader = req.headers['x-service-secret'];
    if (typeof serviceIdHeader === 'string' && typeof serviceSecretHeader === 'string') {
      const account = verifyServiceCredentials(serviceIdHeader, serviceSecretHeader);
      if (account) {
        (req as any).serviceAccount = account;
        return next();
      }
    }

    // Legacy single-header service key support
    const apiKey = req.headers['x-service-key'];
    if (apiKey && typeof apiKey === 'string') {
      const account = verifyApiKey(apiKey);
      if (account) {
        (req as any).serviceAccount = account;
        return next();
      }
    }
    res.status(401).json({ error: "Unauthorized" });
  };

  // --- Config ---
  app.get("/api/config", (req, res) => {
    res.json({ mock: USE_MOCKS });
  });

  // --- Authentik SSO ---
  app.get("/api/auth/url", (req, res) => {
    const authentikBaseUrl = getAuthentikBaseUrl();
    
    if (USE_MOCKS && process.env.NODE_ENV === 'development' && !authentikBaseUrl) {
      // Return a URL to our mock login endpoint
      const mockUrl = `${req.protocol}://${req.get('host')}/api/auth/mock-login`;
      return res.json({ url: mockUrl });
    }
    
    if (!authentikBaseUrl) {
      return res.status(500).json({ error: "AUTHENTIK_URL or AUTHENTIK_ISSUER is not configured" });
    }

    const redirectUri = req.query.redirect_uri as string || `${process.env.APP_URL}/api/auth/callback`;
    
    // Encode redirectUri into state so we can recover it in the callback
    const state = Buffer.from(JSON.stringify({ redirectUri })).toString('base64');

    const params = new URLSearchParams({
      client_id: process.env.AUTHENTIK_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      state: state,
    });
    
    const authUrl = `${authentikBaseUrl}/application/o/authorize/?${params}`;
    res.json({ url: authUrl });
  });

  app.get("/api/auth/mock-login", (req, res) => {
    if (!USE_MOCKS) {
      return res.status(404).send("Mock login is disabled");
    }
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', token: 'mock-admin-token', user: { id: "admin", name: "Administrator" } }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Mock Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  });

  app.get(['/api/auth/callback', '/api/auth/callback/'], async (req, res) => {
    const { code, state } = req.query;
    if (!code) {
      return res.status(400).send("No code provided");
    }

    let redirectUri = `${process.env.APP_URL}/api/auth/callback`;
    if (state && typeof state === 'string') {
      try {
        const decodedState = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
        if (decodedState.redirectUri) {
          redirectUri = decodedState.redirectUri;
        }
      } catch (e) {
        console.error("Failed to parse state", e);
      }
    }

    try {
      const authentikBaseUrl = getAuthentikBaseUrl();
      if (!authentikBaseUrl) {
        throw new Error("AUTHENTIK_URL or AUTHENTIK_ISSUER is not configured");
      }

      const tokenRes = await fetch(`${authentikBaseUrl}/application/o/token/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code as string,
          client_id: process.env.AUTHENTIK_CLIENT_ID!,
          client_secret: process.env.AUTHENTIK_CLIENT_SECRET!,
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenRes.ok) {
        const errorText = await tokenRes.text();
        console.error("Token exchange failed:", errorText);
        throw new Error("Failed to exchange token");
      }

      const tokenData = await tokenRes.json();
      
      // Fetch user info
      const userRes = await fetch(`${authentikBaseUrl}/application/o/userinfo/`, {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`
        }
      });
      
      const userData = await userRes.json();
      
      // Create our own JWT
      const token = jwt.sign({ id: userData.sub, name: userData.name || userData.preferred_username }, JWT_SECRET, { expiresIn: '7d' });

      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', token: '${token}', user: { id: '${userData.sub}', name: '${userData.name || userData.preferred_username}' } }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful. This window should close automatically.</p>
          </body>
        </html>
      `);
    } catch (e) {
      console.error(e);
      res.status(500).send("Authentication failed");
    }
  });

  app.get("/api/auth/me", (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      if (USE_MOCKS && token === 'mock-admin-token') {
        return res.json({ id: "admin", name: "Administrator" });
      }
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        return res.json(decoded);
      } catch (e) {
        // ignore
      }
    }
    res.status(401).json({ error: "Not logged in" });
  });

  // --- Service Discovery ---
  app.get("/api/states", requireAuth, async (req, res) => {
    if (process.env.HA_URL && process.env.HA_TOKEN) {
      try {
        const haRes = await fetchFromHomeAssistant("/api/states");
        if (!haRes.ok) {
          console.error(`Failed to fetch states from Home Assistant: HTTP ${haRes.status} ${haRes.statusText}`);
          return res.json([]);
        } else {
          const states = await haRes.json();
          return res.json(states);
        }
      } catch (e: any) {
        console.error(e.message || "Error connecting to Home Assistant");
        return res.json([]);
      }
    }
    res.json([]);
  });

  app.get("/api/services", requireAuth, async (req, res) => {
    // If HA_URL and HA_TOKEN are set, fetch from real HA
    if (process.env.HA_URL && process.env.HA_TOKEN) {
      try {
        const haRes = await fetchFromHomeAssistant("/api/services");
        if (!haRes.ok) {
          console.error(`Failed to fetch services from Home Assistant: HTTP ${haRes.status} ${haRes.statusText}`);
          // Fallback to mock
        } else {
          const services = await haRes.json();
          return res.json(services);
        }
      } catch (e: any) {
        console.error(e.message || "Error connecting to Home Assistant");
        // Fallback to mock
      }
    }

    if (!USE_MOCKS) {
      return res.json([]);
    }

    // Mocking a realistic Home Assistant /api/services response
    // In a real app, this would proxy to the actual HA instance
    const services = [
      {
        domain: "homeassistant",
        services: {
          turn_on: { name: "Turn on" },
          turn_off: { name: "Turn off" },
          toggle: { name: "Toggle" }
        }
      },
      {
        domain: "light",
        services: {
          turn_on: { name: "Turn on" },
          turn_off: { name: "Turn off" },
          toggle: { name: "Toggle" }
        }
      },
      {
        domain: "switch",
        services: {
          turn_on: { name: "Turn on" },
          turn_off: { name: "Turn off" },
          toggle: { name: "Toggle" }
        }
      }
    ];
    res.json(services);
  });

  app.post("/api/call_service", requireAuth, async (req, res) => {
    if (process.env.HA_URL && process.env.HA_TOKEN) {
      try {
        const { domain, service, serviceData } = req.body;
        const haRes = await fetchFromHomeAssistant(`/api/services/${domain}/${service}`, {
          method: 'POST',
          body: JSON.stringify(serviceData || {})
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
    
    if (!USE_MOCKS) {
      return res.status(500).json({ error: "Home Assistant is not configured on the server" });
    }
    
    res.json([{ success: true, mock: true }]);
  });

  // --- Service Accounts ---
  app.get("/api/service-accounts", requireAuth, (req, res) => {
    res.json(getServiceAccounts());
  });

  app.post("/api/service-accounts", requireAuth, (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });
    
    const id = uuidv4();
    const apiKey = `sk_${uuidv4().replace(/-/g, '')}`;
    
    createServiceAccount(id, name, apiKey);
    res.json({
      id,
      name,
      apiKey, // legacy field
      serviceId: id,
      serviceSecret: apiKey,
      headers: {
        "x-service-id": id,
        "x-service-secret": apiKey,
      },
    });
  });

  app.delete("/api/service-accounts/:id", requireAuth, (req, res) => {
    deleteServiceAccount(req.params.id);
    res.json({ success: true });
  });

  // --- Scripts ---
  app.get("/api/scripts", requireAuth, (req, res) => {
    res.json(getScripts());
  });

  app.get("/api/scripts/:id", requireAuth, (req, res) => {
    const script = getScriptById(req.params.id);
    if (!script) return res.status(404).json({ error: "Not found" });
    res.json(script);
  });

  app.post("/api/scripts", requireAuth, (req, res) => {
    const { name, code, endpoint, testParams } = req.body;
    if (!name || !code || !endpoint) return res.status(400).json({ error: "Missing fields" });
    
    const id = uuidv4();
    try {
      createScript(id, name, code, endpoint, testParams || '{}');
      res.json({ id, name, code, endpoint, testParams: testParams || '{}' });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put("/api/scripts/:id", requireAuth, (req, res) => {
    const { name, code, endpoint, testParams } = req.body;
    if (!name || !code || !endpoint) return res.status(400).json({ error: "Missing fields" });
    
    try {
      updateScript(req.params.id, name, code, endpoint, testParams || '{}');
      res.json({ id: req.params.id, name, code, endpoint, testParams: testParams || '{}' });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/scripts/:id", requireAuth, (req, res) => {
    deleteScript(req.params.id);
    res.json({ success: true });
  });

  // --- Execute Script Endpoint ---
  app.post("/api/run/:endpoint", requireAuth, async (req, res) => {
    const script = getScriptByEndpoint(req.params.endpoint);
    if (!script) return res.status(404).json({ error: "Endpoint not found" });

    // Variables from query params and body
    const variables = { ...req.query, ...req.body };
    const startedAt = Date.now();
    const requestId = uuidv4();
    const events: ExecutionEvent[] = [];
    const haStates: HAStateEvent[] = [];
    const authMode: "jwt" | "service_key" | "mock" | "unknown" =
      (req as any).serviceAccount ? "service_key" :
      (req as any).user?.id === "admin" && USE_MOCKS ? "mock" :
      (req as any).user ? "jwt" : "unknown";
    const haMode: "real" | "mock" = process.env.HA_URL && process.env.HA_TOKEN ? "real" : "mock";

    const logEvent = (event: Omit<ExecutionEvent, "id" | "timestamp">) => {
      events.push({
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        ...event,
      });
    };

    const mapEngineLevel = (level?: HomeScriptTraceEvent["level"]): ExecutionEvent["level"] => {
      if (level === "error") return "error";
      if (level === "success") return "success";
      if (level === "warning") return "warning";
      return "info";
    };
    
    const engine = new HomeScriptEngine({
      variables,
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
        // Real Home Assistant Integration
        if (process.env.HA_URL && process.env.HA_TOKEN) {
          const [domain, serviceName] = service.split('.');
          if (!domain || !serviceName) {
            throw new Error(`Invalid service format: ${service}`);
          }

          let payload = {};
          if (args.length > 0) {
            if (typeof args[0] === 'object') {
              payload = args[0];
            } else if (typeof args[0] === 'string') {
              payload = { entity_id: args[0] };
            }
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
              haStates.push({
                timestamp: new Date().toISOString(),
                action: "call",
                status: "fail",
                service,
                payload,
                error: errText,
              });
              logEvent({
                source: "ha",
                level: "error",
                message: `HA CALL failed: ${service}`,
                details: { payload, error: errText, durationMs: Date.now() - callStart },
              });
              throw new Error(`Home Assistant Error (${haRes.status}): ${errText}`);
            }

            const result = await haRes.json();
            haStates.push({
              timestamp: new Date().toISOString(),
              action: "call",
              status: "success",
              service,
              payload,
              value: result,
            });
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

        // Mock Fallback
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
              haStates.push({
                timestamp: new Date().toISOString(),
                action: "get",
                status: "fail",
                entityId,
                error: errText,
              });
              logEvent({
                source: "ha",
                level: "error",
                message: `HA GET failed: ${entityId}`,
                details: { error: errText, durationMs: Date.now() - getStart },
              });
              throw new Error(`Home Assistant Error (${haRes.status}): ${errText}`);
            }

            const result = await haRes.json();
            haStates.push({
              timestamp: new Date().toISOString(),
              action: "get",
              status: "success",
              entityId,
              value: result.state,
            });
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
        haStates.push({
          timestamp: new Date().toISOString(),
          action: "get",
          status: "success",
          entityId,
          value: "mock_state",
        });
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
            const domain = entityId.split('.')[0];
            let serviceDomain = 'homeassistant';
            let serviceName = '';
            let payload: any = { entity_id: entityId };

            if (state === 'on' || state === true) {
              serviceName = 'turn_on';
            } else if (state === 'off' || state === false) {
              serviceName = 'turn_off';
            } else if (domain === 'input_number') {
              serviceDomain = 'input_number';
              serviceName = 'set_value';
              payload.value = Number(state);
            } else if (domain === 'input_select') {
              serviceDomain = 'input_select';
              serviceName = 'select_option';
              payload.option = String(state);
            } else if (domain === 'input_text') {
              serviceDomain = 'input_text';
              serviceName = 'set_value';
              payload.value = String(state);
            } else if (domain === 'input_boolean') {
              serviceDomain = 'input_boolean';
              serviceName = state ? 'turn_on' : 'turn_off';
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

            const result = await haRes.json();
            haStates.push({
              timestamp: new Date().toISOString(),
              action: "set",
              status: "success",
              entityId,
              value: result.state,
            });
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
        haStates.push({
          timestamp: new Date().toISOString(),
          action: "set",
          status: "success",
          entityId,
          value: state,
        });
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
        if (!importedScript) {
            throw new Error(`Script with endpoint '${name}' not found`);
        }
        return importedScript.code as string;
      }
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
        error: {
          message: e.message,
          line: e.line,
        },
        meta: {
          requestId,
          endpoint: req.params.endpoint,
          authMode,
          haMode,
          durationMs: Date.now() - startedAt,
          httpStatus: 400,
        },
      };
      res.status(400).json({ error: e.message, line: e.line, report });
    }
  });

  // --- Webhook Endpoint ---
  app.post("/api/webhook/:endpoint", async (req, res) => {
    const script = getScriptByEndpoint(req.params.endpoint);
    if (!script) return res.status(404).json({ error: "Endpoint not found" });

    // Variables from query params and body
    const variables = { 
        ...req.query, 
        webhook_data: req.body,
        webhook_query: req.query
    };
    
    const engine = new HomeScriptEngine({
      variables,
      onCall: async (service, args) => {
        // Real Home Assistant Integration
        if (process.env.HA_URL && process.env.HA_TOKEN) {
          const [domain, serviceName] = service.split('.');
          if (!domain || !serviceName) {
            throw new Error(`Invalid service format: ${service}`);
          }

          let payload = {};
          if (args.length > 0) {
            if (typeof args[0] === 'object') {
              payload = args[0];
            } else if (typeof args[0] === 'string') {
              payload = { entity_id: args[0] };
            }
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

            const result = await haRes.json();
            return { success: true, ha_response: result };
          } catch (e: any) {
            throw new Error(`Failed to call Home Assistant: ${e.message}`);
          }
        }

        // Mock Fallback
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

            const result = await haRes.json();
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
            const domain = entityId.split('.')[0];
            let serviceDomain = 'homeassistant';
            let serviceName = '';
            let payload: any = { entity_id: entityId };

            if (state === 'on' || state === true) {
              serviceName = 'turn_on';
            } else if (state === 'off' || state === false) {
              serviceName = 'turn_off';
            } else if (domain === 'input_number') {
              serviceDomain = 'input_number';
              serviceName = 'set_value';
              payload.value = Number(state);
            } else if (domain === 'input_select') {
              serviceDomain = 'input_select';
              serviceName = 'select_option';
              payload.option = String(state);
            } else if (domain === 'input_text') {
              serviceDomain = 'input_text';
              serviceName = 'set_value';
              payload.value = String(state);
            } else if (domain === 'input_boolean') {
              serviceDomain = 'input_boolean';
              serviceName = state ? 'turn_on' : 'turn_off';
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

            const result = await haRes.json();
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
        if (!importedScript) {
            throw new Error(`Script with endpoint '${name}' not found`);
        }
        return importedScript.code as string;
      }
    });
    try {
      const result = await engine.execute(script.code as string);
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e.message, line: e.line });
    }
  });
}
