import { Express } from "express";
import jwt from "jsonwebtoken";
import { RouteContext } from "../types.js";
import { createRateLimit } from "../rate-limit.js";

const getTrustedAppOrigin = (req: any): string => {
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    try {
      return new URL(appUrl).origin;
    } catch {
      // Fall back to current host if APP_URL is malformed.
    }
  }
  return `${req.protocol}://${req.get("host")}`;
};

export const registerAuthRoutes = (app: Express, ctx: RouteContext) => {
  const authRouteLimit = createRateLimit({
    maxRequests: 30,
    windowMs: 60_000,
    key: (req) => `${req.ip}:auth`,
    errorMessage: "Too many authentication requests",
  });

  app.get("/api/auth/url", authRouteLimit, (req, res) => {
    const authentikBaseUrl = ctx.getAuthentikBaseUrl();

    if (ctx.USE_MOCKS && process.env.NODE_ENV === "development" && !authentikBaseUrl) {
      const mockUrl = `${req.protocol}://${req.get("host")}/api/auth/mock-login`;
      return res.json({ url: mockUrl });
    }

    if (!authentikBaseUrl) {
      return res.status(500).json({ error: "AUTHENTIK_URL or AUTHENTIK_ISSUER is not configured" });
    }

    const redirectUri = (req.query.redirect_uri as string) || `${process.env.APP_URL}/api/auth/callback`;
    const state = Buffer.from(JSON.stringify({ redirectUri })).toString("base64");

    const params = new URLSearchParams({
      client_id: process.env.AUTHENTIK_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid profile email",
      state,
    });

    const authUrl = `${authentikBaseUrl}/application/o/authorize/?${params}`;
    res.json({ url: authUrl });
  });

  app.get("/api/auth/mock-login", authRouteLimit, (_req, res) => {
    if (!ctx.USE_MOCKS) {
      return res.status(404).send("Mock login is disabled");
    }
    const trustedOrigin = getTrustedAppOrigin(_req);
    const authPayload = JSON.stringify({
      type: "OAUTH_AUTH_SUCCESS",
      token: "mock-admin-token",
      user: { id: "admin", name: "Administrator" },
    });
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              const payload = ${JSON.stringify(authPayload)};
              const targetOrigin = ${JSON.stringify(trustedOrigin)};
              window.opener.postMessage(JSON.parse(payload), targetOrigin);
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

  app.get(["/api/auth/callback", "/api/auth/callback/"], authRouteLimit, async (req, res) => {
    const { code, state } = req.query;
    if (!code) {
      return res.status(400).send("No code provided");
    }

    let redirectUri = `${process.env.APP_URL}/api/auth/callback`;
    if (state && typeof state === "string") {
      try {
        const decodedState = JSON.parse(Buffer.from(state, "base64").toString("utf-8"));
        if (decodedState.redirectUri) {
          redirectUri = decodedState.redirectUri;
        }
      } catch (e) {
        console.error("Failed to parse state", e);
      }
    }

    try {
      const authentikBaseUrl = ctx.getAuthentikBaseUrl();
      if (!authentikBaseUrl) {
        throw new Error("AUTHENTIK_URL or AUTHENTIK_ISSUER is not configured");
      }

      const tokenRes = await fetch(`${authentikBaseUrl}/application/o/token/`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
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

      const tokenData: any = await tokenRes.json();
      const userRes = await fetch(`${authentikBaseUrl}/application/o/userinfo/`, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const userData: any = await userRes.json();

      const token = jwt.sign(
        { id: userData.sub, name: userData.name || userData.preferred_username },
        ctx.JWT_SECRET,
        { expiresIn: "7d" }
      );
      const trustedOrigin = getTrustedAppOrigin(req);
      const authPayload = JSON.stringify({
        type: "OAUTH_AUTH_SUCCESS",
        token,
        user: {
          id: String(userData.sub || ""),
          name: String(userData.name || userData.preferred_username || ""),
        },
      });

      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                const payload = ${JSON.stringify(authPayload)};
                const targetOrigin = ${JSON.stringify(trustedOrigin)};
                window.opener.postMessage(JSON.parse(payload), targetOrigin);
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
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      if (ctx.USE_MOCKS && token === "mock-admin-token") {
        return res.json({ id: "admin", name: "Administrator" });
      }
      try {
        const decoded = jwt.verify(token, ctx.JWT_SECRET);
        return res.json(decoded);
      } catch {
        // ignore
      }
    }
    res.status(401).json({ error: "Not logged in" });
  });
};
