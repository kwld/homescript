import "dotenv/config";
import express from "express";
import session from "express-session";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import { setupRoutes } from "./src/server/routes.js";
import { initDb } from "./src/server/db.js";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Initialize DB
  initDb();

  app.use(cors());
  app.use(express.json());
  app.set('trust proxy', 1);
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "super-secret-key",
      resave: false,
      saveUninitialized: false,
      proxy: true, // Force trust proxy for secure cookies
      cookie: {
        secure: true,
        sameSite: 'none',
        httpOnly: true,
      }
    })
  );

  // Setup API routes
  setupRoutes(app);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
