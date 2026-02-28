import { Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { verifyApiKey, verifyServiceCredentials } from "../db.js";

export const createRequireAuth = (JWT_SECRET: string, USE_MOCKS: boolean): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    if ((req as any).user || (req as any).serviceAccount) {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      if (USE_MOCKS && token === "mock-admin-token") {
        (req as any).user = { id: "admin", name: "Administrator" };
        return next();
      }
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        (req as any).user = decoded;
        return next();
      } catch {
        // ignore
      }
    }

    const serviceIdHeader = req.headers["x-service-id"];
    const serviceSecretHeader = req.headers["x-service-secret"];
    if (typeof serviceIdHeader === "string" && typeof serviceSecretHeader === "string") {
      const account = verifyServiceCredentials(serviceIdHeader, serviceSecretHeader);
      if (account) {
        (req as any).serviceAccount = account;
        return next();
      }
    }

    const apiKey = req.headers["x-service-key"];
    if (apiKey && typeof apiKey === "string") {
      const account = verifyApiKey(apiKey);
      if (account) {
        (req as any).serviceAccount = account;
        return next();
      }
    }

    res.status(401).json({ error: "Unauthorized" });
  };
};
