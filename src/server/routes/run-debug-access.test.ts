import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { createServiceAccount, deleteServiceAccount, initDb, updateDebugAccessSettings } from "../db.js";
import { createRunDebugAccessMiddleware } from "./run-debug-access.js";

type ReqLike = {
  headers: Record<string, string | undefined>;
  ip: string;
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

describe("createRunDebugAccessMiddleware", () => {
  const middleware = createRunDebugAccessMiddleware();
  const createdServiceIds: string[] = [];

  beforeAll(() => {
    initDb();
  });

  afterEach(() => {
    updateDebugAccessSettings(false, []);
    while (createdServiceIds.length > 0) {
      const id = createdServiceIds.pop();
      if (id) deleteServiceAccount(id);
    }
  });

  it("does nothing when bypass is disabled", () => {
    updateDebugAccessSettings(false, ["127.0.0.1/32"]);
    const req: ReqLike = {
      ip: "127.0.0.1",
      headers: { "x-service-id": "svc1" },
    };
    const res = makeRes();
    let nextCalled = false;
    middleware(req as any, res as any, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(req.serviceAccount).toBeUndefined();
  });

  it("accepts bypass only for whitelisted ip and existing service id", () => {
    const id = randomUUID();
    const secret = `sk_${randomUUID().replace(/-/g, "")}`;
    createServiceAccount(id, "svc-debug", secret);
    createdServiceIds.push(id);

    updateDebugAccessSettings(true, ["127.0.0.1/32"]);
    const req: ReqLike = {
      ip: "127.0.0.1",
      headers: { "x-service-id": id },
    };
    const res = makeRes();
    let nextCalled = false;
    middleware(req as any, res as any, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(req.debugBypassAuth).toBe(true);
    expect(req.serviceAccount?.id).toBe(id);
  });

  it("rejects bypass request from non-whitelisted ip", () => {
    const id = randomUUID();
    const secret = `sk_${randomUUID().replace(/-/g, "")}`;
    createServiceAccount(id, "svc-debug", secret);
    createdServiceIds.push(id);

    updateDebugAccessSettings(true, ["10.0.0.0/8"]);
    const req: ReqLike = {
      ip: "127.0.0.1",
      headers: { "x-service-id": id },
    };
    const res = makeRes();
    let nextCalled = false;
    middleware(req as any, res as any, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("does not bypass when service id is missing", () => {
    updateDebugAccessSettings(true, ["127.0.0.1/32"]);
    const req: ReqLike = {
      ip: "127.0.0.1",
      headers: {},
    };
    const res = makeRes();
    let nextCalled = false;
    middleware(req as any, res as any, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(req.debugBypassAuth).toBeUndefined();
  });

  it("fails closed when whitelist entry is malformed in debug mode", () => {
    const id = randomUUID();
    const secret = `sk_${randomUUID().replace(/-/g, "")}`;
    createServiceAccount(id, "svc-debug", secret);
    createdServiceIds.push(id);

    updateDebugAccessSettings(true, ["not-a-cidr"]);
    const req: ReqLike = {
      ip: "127.0.0.1",
      headers: { "x-service-id": id },
    };
    const res = makeRes();
    let nextCalled = false;
    middleware(req as any, res as any, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });
});
