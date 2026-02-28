# Security Audit

Date: 2026-02-28  
Project: HomeScript Studio  
Scope: Server auth, service-to-service API, websocket execution channel, HA integration, dependency risk, and secret handling.

## Summary

Overall status: **Reduced risk** (core auth/secret/transport issues remediated; still needs schema and header hardening for hostile exposure).

Implemented remediations:
- Mock mode is development-only opt-in (`MOCK=enabled`) and server startup hard-fails if enabled in production.
- Service secrets are stored hashed at rest (`scrypt` + per-secret salt), with legacy plaintext auto-migration on successful authentication.
- OAuth popup callback/login now posts auth payload only to trusted app origin (no wildcard `*`).
- Added in-memory rate limiting for auth routes, service-account management, script execution routes, webhook route, and websocket auth failures.
- Webhook endpoint now enforces timestamped HMAC signature validation (`x-webhook-timestamp`, `x-webhook-signature`) and replay-window checks.

Open hardening items:
- Add centralized request schema validation for HTTP and websocket payloads.
- Add explicit security headers policy (`helmet` + CSP/referrer/frameguard configuration).

## Findings Status

### Critical

1. Mock token authentication default bypass  
Status: **Resolved** (2026-02-28)

### High

1. Plaintext service secrets in database  
Status: **Partially resolved** (hash-at-rest implemented; rotation/revocation workflow still recommended)

2. Unauthenticated webhook execution endpoint  
Status: **Resolved** (required HMAC timestamp/signature validation)

### Medium

1. Missing rate limiting and lockout  
Status: **Resolved**

2. OAuth callback postMessage wildcard target (`*`)  
Status: **Resolved**

3. No centralized input schema validation for execute endpoints  
Status: **Open**

4. No formal security headers policy  
Status: **Open**

### Low

1. Session cookie secure settings may break on non-TLS local setups  
Status: **Accepted risk** (document TLS/reverse-proxy requirements)

## Dependency Audit

Command executed:
- `npm audit --omit=dev --json`

Result at audit time:
- Total prod vulnerabilities: **0**

Note:
- This is point-in-time and should run in CI regularly.

## Existing Automated Security Tests

- `src/server/routes/middleware.test.ts`

Covered behavior:
- valid JWT accepted
- invalid JWT rejected
- `x-service-id` + `x-service-secret` accepted
- legacy `x-service-key` accepted
- service secrets are persisted hashed
- mock token accepted only when mock mode is explicitly enabled in middleware
- anonymous request rejected

## Recommended Next Security Actions

1. Add strict schema validation (zod/valibot) for all HTTP + WS payloads.
2. Add `helmet` with explicit CSP and related headers policy.
3. Add service secret rotation endpoint/workflow.
4. Add metrics/alerting for auth failures and rate-limit violations.

## Verification Commands

```bash
npm run lint
npm run test
npm audit --omit=dev
```
