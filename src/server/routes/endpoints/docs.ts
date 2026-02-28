import { Express } from "express";
import { RouteContext } from "../types.js";
import { buildScriptsOpenApiDocument, buildServerOpenApiDocument } from "../../openapi.js";

const buildSwaggerHtml = (token: string, openApiUrl: string, title: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    html, body { margin: 0; padding: 0; background: #0a0a0a; height: 100%; }
    #swagger-ui { height: 100vh; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: ${JSON.stringify(openApiUrl)},
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis],
      requestInterceptor: (req) => {
        const token = ${JSON.stringify(token)};
        if (token) req.headers.Authorization = 'Bearer ' + token;
        return req;
      }
    });
  </script>
</body>
</html>`;

export const registerDocsRoutes = (app: Express, ctx: RouteContext) => {
  app.get("/api/docs/scripts/openapi.json", ctx.requireAuth, (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.json(buildScriptsOpenApiDocument());
  });

  app.get("/api/docs/scripts/frame", ctx.requireAuth, (req, res) => {
    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return res.status(401).json({ error: "Missing bearer token for docs frame" });
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(buildSwaggerHtml(token, "/api/docs/scripts/openapi.json", "HomeScripts API Docs"));
  });

  app.get("/api/docs/scripts", ctx.requireAuth, (req, res) => {
    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(buildSwaggerHtml(token, "/api/docs/scripts/openapi.json", "HomeScripts API Docs"));
  });

  app.get("/api/docs/server/openapi.json", ctx.requireAuth, (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.json(buildServerOpenApiDocument());
  });

  app.get("/api/docs/server", ctx.requireAuth, (req, res) => {
    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(buildSwaggerHtml(token, "/api/docs/server/openapi.json", "Server API Docs"));
  });
};
