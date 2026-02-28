import { Request, RequestHandler } from "express";

type RateLimitOptions = {
  maxRequests: number;
  windowMs: number;
  key?: (req: Request) => string;
  errorMessage?: string;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export const createRateLimit = (options: RateLimitOptions): RequestHandler => {
  const entries = new Map<string, RateLimitEntry>();

  return (req, res, next) => {
    const now = Date.now();
    const key = options.key ? options.key(req) : req.ip;
    const existing = entries.get(key);

    if (!existing || existing.resetAt <= now) {
      entries.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    existing.count += 1;
    if (existing.count > options.maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ error: options.errorMessage || "Too many requests" });
    }

    return next();
  };
};
