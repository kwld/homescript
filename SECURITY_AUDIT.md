# Security Audit

Date: 2026-02-28  
Project: HomeScript Studio  
Scope: Server auth, service-to-service API, websocket execution channel, HA integration, dependency risk, and secret handling.

## Summary

Overall status: **Moderate risk** (workable for controlled environments, not hardened for hostile internet exposure yet).

What is strong:
- Service-to-service auth supports two-header credentials (`x-service-id` + `x-service-secret`).
- JWT auth enforced for protected UI/API paths.
- WebSocket execution channel requires explicit auth before run.
- HA request timeout/error normalization is implemented.
- Production dependency audit result is clean (`npm audit --omit=dev` => 0 known vulnerabilities at audit time).

Main risks to address before broad public exposure:
- No rate limiting/brute-force protection on auth-sensitive endpoints and WS auth attempts.
- Secrets are stored plaintext in local SQLite.
- Webhook execution endpoint has no service credential authentication by design.
- OAuth popup callback currently posts token to `*` (wildcard target in embedded script).

## Findings

### Critical

None identified in current static/code audit.

### High

1. Plaintext service secrets in database  
Risk: DB compromise leaks all service credentials immediately.  
Current state: `service_accounts.api_key` stores raw secret.  
Recommendation:
- Store only hashed service secrets (e.g. Argon2id/bcrypt + per-secret salt).
- Show secret once at creation; verify by hash only.
- Add secret rotation/revocation workflow.

2. Unauthenticated webhook execution endpoint  
Risk: anyone with endpoint knowledge can trigger actions if endpoint is exposed.  
Current state: `POST /api/webhook/:endpoint` has no auth middleware.  
Recommendation:
- Add optional HMAC signature validation per script.
- Support per-webhook secret and timestamp replay protection.
- Allow explicit disable/enable per script.

### Medium

1. Missing rate limiting and lockout  
Risk: brute-force against service credentials/JWT routes/WS auth.  
Recommendation:
- Add IP+service-id rate limits to:
  - `/api/service-accounts`
  - `/api/run/:endpoint`
  - `/api/ws/service` auth
  - auth callback/url paths as needed.

2. OAuth callback postMessage wildcard target (`*`)  
Risk: token leakage if opener context is malicious.  
Recommendation:
- Restrict `postMessage` target origin to trusted `APP_URL` origin.
- Validate opener origin more strictly.

3. No centralized input schema validation for execute endpoints  
Risk: malformed payloads can create unexpected execution states and harder incident diagnosis.  
Recommendation:
- Add request schema validation (zod/valibot) for route bodies and WS messages.

4. No formal security headers policy  
Risk: weaker browser hardening defaults.  
Recommendation:
- Add `helmet` and configure CSP, frameguard, referrer-policy, etc.

### Low

1. Mock auth token available when mocks enabled  
Risk: accidental non-dev usage with weak trust assumptions.  
Recommendation:
- Force explicit `NODE_ENV=development` check for all mock auth shortcuts.
- Emit startup warning when mocks are enabled.

2. Session cookie secure settings may break on non-TLS local setups  
Recommendation:
- Keep secure defaults, but document reverse-proxy/TLS requirements clearly.

## Dependency Audit

Command executed:
- `npm audit --omit=dev --json`

Result at audit time:
- Total prod vulnerabilities: **0**

Note:
- This is point-in-time and should run in CI regularly.

## Existing Automated Security Tests

Added tests:
- `src/server/routes/middleware.test.ts`

Covered cases:
- valid JWT accepted
- invalid JWT rejected
- `x-service-id` + `x-service-secret` accepted
- legacy `x-service-key` accepted
- mock admin token accepted only with mock mode enabled
- anonymous request rejected

## Recommended Next Security Actions (Priority Order)

1. Hash service secrets at rest.
2. Add webhook signature auth and replay protection.
3. Add rate limits for auth/run/websocket endpoints.
4. Restrict OAuth callback postMessage target origin.
5. Add schema validation for HTTP + WS payloads.
6. Add `helmet` with explicit security headers policy.

## Verification Commands

```bash
npm run lint
npm run test
npm audit --omit=dev
```
