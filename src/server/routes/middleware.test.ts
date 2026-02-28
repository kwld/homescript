import { describe, it, expect, beforeAll, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { createRequireAuth } from "./middleware.js";
import { createServiceAccount, deleteServiceAccount, initDb } from "../db.js";

type ReqLike = {
  headers: Record<string, string | undefined>;
  [key: string]: any;
};

type ResLike = {
  statusCode?: number;
  body?: any;
  status: (code: number) => ResLike;
  json: (payload: any) => ResLike;
};

const makeRes = (): ResLike => {
  const res: ResLike = {
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
  return res;
};

describe("createRequireAuth security behavior", () => {
  const jwtSecret = "test-secret";
  const requireAuth = createRequireAuth(jwtSecret, false);
  const requireAuthWithMock = createRequireAuth(jwtSecret, true);
  const createdServiceIds: string[] = [];

  beforeAll(() => {
    initDb();
  });

  afterEach(() => {
    while (createdServiceIds.length > 0) {
      const id = createdServiceIds.pop();
      if (id) {
        deleteServiceAccount(id);
      }
    }
  });

  it("allows valid bearer JWT", () => {
    const token = jwt.sign({ id: "u1", name: "User One" }, jwtSecret, { expiresIn: "1h" });
    const req: ReqLike = { headers: { authorization: `Bearer ${token}` } };
    const res = makeRes();
    let nextCalled = false;

    requireAuth(req as any, res as any, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.user).toBeDefined();
    expect(res.statusCode).toBeUndefined();
  });

  it("rejects invalid bearer JWT", () => {
    const req: ReqLike = { headers: { authorization: "Bearer invalid-token" } };
    const res = makeRes();
    let nextCalled = false;

    requireAuth(req as any, res as any, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });

  it("allows x-service-id + x-service-secret credentials", () => {
    const id = randomUUID();
    const secret = `sk_${randomUUID().replace(/-/g, "")}`;
    createServiceAccount(id, "svc-test", secret);
    createdServiceIds.push(id);

    const req: ReqLike = {
      headers: {
        "x-service-id": id,
        "x-service-secret": secret,
      },
    };
    const res = makeRes();
    let nextCalled = false;

    requireAuth(req as any, res as any, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.serviceAccount).toBeDefined();
    expect(req.serviceAccount.id).toBe(id);
  });

  it("allows legacy x-service-key credentials", () => {
    const id = randomUUID();
    const secret = `sk_${randomUUID().replace(/-/g, "")}`;
    createServiceAccount(id, "svc-legacy", secret);
    createdServiceIds.push(id);

    const req: ReqLike = {
      headers: {
        "x-service-key": secret,
      },
    };
    const res = makeRes();
    let nextCalled = false;

    requireAuth(req as any, res as any, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.serviceAccount).toBeDefined();
    expect(req.serviceAccount.id).toBe(id);
  });

  it("allows explicit mock token only when mocks are enabled", () => {
    const req: ReqLike = { headers: { authorization: "Bearer mock-admin-token" } };
    const res = makeRes();
    let nextCalled = false;

    requireAuthWithMock(req as any, res as any, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.user).toEqual({ id: "admin", name: "Administrator" });
  });

  it("rejects anonymous requests", () => {
    const req: ReqLike = { headers: {} };
    const res = makeRes();
    let nextCalled = false;

    requireAuth(req as any, res as any, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });
});
