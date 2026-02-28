import { getScriptsWithTriggerConfigs } from "./db.js";
import { getOpenApiRevision } from "./openapi-revision.js";

type ScriptRow = {
  id: string;
  name: string;
  endpoint: string;
  code: string;
  trigger_config: string;
};

const parseRequiredOptionalFromCode = (code: string) => {
  const required: string[] = [];
  const optional: string[] = [];
  const lines = String(code || "").split("\n");

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const req = line.match(/^REQUIRED\s+\$([a-zA-Z0-9_]+)$/);
    if (req) {
      required.push(req[1]);
      continue;
    }
    const opt = line.match(/^OPTIONAL\s+\$([a-zA-Z0-9_]+)$/);
    if (opt) {
      optional.push(opt[1]);
      continue;
    }
    break;
  }

  return { required, optional };
};

export const buildScriptsOpenApiDocument = () => {
  const scripts = getScriptsWithTriggerConfigs() as ScriptRow[];
  const paths: Record<string, any> = {};

  scripts.forEach((s) => {
    const decl = parseRequiredOptionalFromCode(s.code);
    const params = [
      ...decl.required.map((name) => ({
        name,
        in: "query",
        required: true,
        schema: { type: "string" },
        description: "Injected by REQUIRED keyword in script",
      })),
      ...decl.optional.map((name) => ({
        name,
        in: "query",
        required: false,
        schema: { type: "string" },
        description: "Injected by OPTIONAL keyword in script",
      })),
    ];

    paths[`/api/run/${s.endpoint}`] = {
      get: {
        tags: ["HomeScripts"],
        summary: `${s.name || s.endpoint} (GET)`,
        description: `Execute HomeScript endpoint '${s.endpoint}' using URL query parameters as runtime variables.`,
        parameters: [
          ...params,
          {
            name: "any_runtime_var",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Any additional query param is available as a script variable in GET mode.",
          },
        ],
        responses: {
          200: { description: "Execution successful" },
          400: { description: "Execution error" },
          401: { description: "Unauthorized" },
          422: { description: "Missing required query variable (REQUIRED $var)" },
        },
      },
      post: {
        tags: ["HomeScripts"],
        summary: `${s.name || s.endpoint} (POST)`,
        description: `Execute HomeScript endpoint '${s.endpoint}' using JSON body as runtime variables.`,
        parameters: params,
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { type: "object", additionalProperties: true },
            },
          },
        },
        responses: {
          200: { description: "Execution successful" },
          400: { description: "Execution error" },
          401: { description: "Unauthorized" },
          422: { description: "Missing required query variable (REQUIRED $var)" },
        },
      },
    };
  });

  return {
    openapi: "3.0.3",
    info: {
      title: "HomeScript Endpoints API",
      version: `1.0.${getOpenApiRevision()}`,
      description: "Dynamically generated from current HomeScript definitions.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
        ServiceId: {
          type: "apiKey",
          in: "header",
          name: "x-service-id",
        },
        ServiceSecret: {
          type: "apiKey",
          in: "header",
          name: "x-service-secret",
        },
        ServiceKey: {
          type: "apiKey",
          in: "header",
          name: "x-service-key",
        },
      },
    },
    security: [{ BearerAuth: [] }, { ServiceId: [], ServiceSecret: [] }, { ServiceKey: [] }],
    tags: [{ name: "HomeScripts" }],
    paths,
  };
};

export const buildServerOpenApiDocument = () => ({
  openapi: "3.0.3",
  info: {
    title: "HomeScript Studio Server API",
    version: `1.0.${getOpenApiRevision()}`,
    description: "General server endpoints (internal docs route).",
  },
  servers: [{ url: "/" }],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
      ServiceId: {
        type: "apiKey",
        in: "header",
        name: "x-service-id",
      },
      ServiceSecret: {
        type: "apiKey",
        in: "header",
        name: "x-service-secret",
      },
      ServiceKey: {
        type: "apiKey",
        in: "header",
        name: "x-service-key",
      },
    },
  },
  security: [{ BearerAuth: [] }, { ServiceId: [], ServiceSecret: [] }, { ServiceKey: [] }],
  tags: [
    { name: "Auth" },
    { name: "Scripts" },
    { name: "HomeAssistant" },
    { name: "ServiceAccounts" },
    { name: "Webhook" },
  ],
  paths: {
    "/api/config": { get: { tags: ["Auth"], summary: "Runtime config", responses: { 200: { description: "Config payload" } } } },
    "/api/auth/url": { get: { tags: ["Auth"], summary: "Get OAuth URL", responses: { 200: { description: "Authentication URL" } } } },
    "/api/auth/me": { get: { tags: ["Auth"], summary: "Current user", responses: { 200: { description: "User" }, 401: { description: "Unauthorized" } } } },
    "/api/scripts": {
      get: { tags: ["Scripts"], summary: "List scripts", responses: { 200: { description: "Scripts list" }, 401: { description: "Unauthorized" } } },
      post: { tags: ["Scripts"], summary: "Create script", responses: { 200: { description: "Created script" }, 400: { description: "Validation error" }, 401: { description: "Unauthorized" } } },
    },
    "/api/scripts/{id}": {
      get: {
        tags: ["Scripts"],
        summary: "Get script by id",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Script" }, 404: { description: "Not found" }, 401: { description: "Unauthorized" } },
      },
      put: {
        tags: ["Scripts"],
        summary: "Update script",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Updated script" }, 400: { description: "Validation error" }, 401: { description: "Unauthorized" } },
      },
      delete: {
        tags: ["Scripts"],
        summary: "Delete script",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Deleted" }, 401: { description: "Unauthorized" } },
      },
    },
    "/api/states": { get: { tags: ["HomeAssistant"], summary: "List states", responses: { 200: { description: "States list" }, 401: { description: "Unauthorized" } } } },
    "/api/services": { get: { tags: ["HomeAssistant"], summary: "List services", responses: { 200: { description: "Services list" }, 401: { description: "Unauthorized" } } } },
    "/api/call_service": { post: { tags: ["HomeAssistant"], summary: "Call HA service", responses: { 200: { description: "Service call result" }, 401: { description: "Unauthorized" } } } },
    "/api/history": {
      get: {
        tags: ["HomeAssistant"],
        summary: "Entity history",
        parameters: [
          { name: "entityId", in: "query", required: true, schema: { type: "string" } },
          { name: "hours", in: "query", required: false, schema: { type: "number" } },
        ],
        responses: { 200: { description: "History response" }, 401: { description: "Unauthorized" } },
      },
    },
    "/api/service-accounts": {
      get: { tags: ["ServiceAccounts"], summary: "List service accounts", responses: { 200: { description: "Service accounts" }, 401: { description: "Unauthorized" } } },
      post: { tags: ["ServiceAccounts"], summary: "Create service account", responses: { 200: { description: "Created service account" }, 401: { description: "Unauthorized" } } },
    },
    "/api/service-accounts/{id}": {
      delete: {
        tags: ["ServiceAccounts"],
        summary: "Delete service account",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Deleted" }, 401: { description: "Unauthorized" } },
      },
    },
    "/api/webhook/{endpoint}": {
      post: {
        tags: ["Webhook"],
        summary: "Execute webhook endpoint",
        parameters: [{ name: "endpoint", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Webhook execution result" }, 401: { description: "Invalid signature" } },
      },
    },
  },
});
