import { RequestHandler } from "express";
import { getDebugAccessSettings, getServiceAccountById } from "../db.js";
import { isIpAllowedByWhitelist, normalizeRequestIp } from "../ip-whitelist.js";

export const createRunDebugAccessMiddleware = (): RequestHandler => {
  return (req, res, next) => {
    const settings = getDebugAccessSettings();
    if (!settings.enabled) return next();

    const serviceId = req.headers["x-service-id"];
    if (typeof serviceId !== "string" || !serviceId.trim()) return next();

    const reqIp = normalizeRequestIp(String(req.ip || ""));
    if (!isIpAllowedByWhitelist(reqIp, settings.whitelist)) {
      return res.status(403).json({ error: "Debug bypass rejected: IP is not in whitelist" });
    }

    const account = getServiceAccountById(serviceId.trim());
    if (!account) {
      return res.status(401).json({ error: "Debug bypass rejected: unknown service account id" });
    }

    (req as any).serviceAccount = account;
    (req as any).debugBypassAuth = true;
    return next();
  };
};
