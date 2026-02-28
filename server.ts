import "dotenv/config";
import express from "express";
import session from "express-session";
import cors from "cors";
import { createServer as createHttpServer } from "http";
import { createServer as createViteServer } from "vite";
import { setupRoutes } from "./src/server/routes.js";
import { initDb } from "./src/server/db.js";
import { setupServiceWebSocket } from "./src/server/ws-service.js";

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  initDb();

  app.use(cors());
  app.use(express.json());
  app.set("trust proxy", 1);
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "super-secret-key",
      resave: false,
      saveUninitialized: false,
      proxy: true,
      cookie: {
        secure: true,
        sameSite: "none",
        httpOnly: true,
      },
    })
  );

  setupRoutes(app);

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  const httpServer = createHttpServer(app);
  setupServiceWebSocket(httpServer);

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
