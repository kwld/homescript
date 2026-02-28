# HomeScript Studio

HomeScript Studio is a web app for creating, testing, and running Home Assistant automations with a custom scripting language called HomeScript.

It includes:
- script editor with local/debug/server execution,
- service account authentication for service-to-service calls,
- HTTP and WebSocket execution APIs,
- Home Assistant REST/WebSocket integration,
- production build and Docker deployment flow.

## Core Features

- HomeScript CRUD:
  - create, edit, delete scripts,
  - assign endpoint names.
- Execution modes:
  - local run,
  - debug run with breakpoints,
  - server run.
- Service-to-service execution:
  - HTTP: `/api/run/:endpoint`
  - Webhook: `/api/webhook/:endpoint`
  - WebSocket: `/api/ws/service`
- Home Assistant integration:
  - state reads,
  - service calls,
  - state writes.

## Tech Stack

- Frontend: React + Vite + TypeScript
- Backend: Node.js + Express + TypeScript
- Database: SQLite (`better-sqlite3`)
- Editor: Monaco
- Transport:
  - REST (app API + HA API)
  - WebSocket (app service channel + HA ws client in UI tools)

## Project Structure

- App entry:
  - `server.ts` (backend bootstrap)
  - `src/main.tsx` (frontend bootstrap)
- Server:
  - `src/server/routes.ts` (route assembler)
  - `src/server/routes/endpoints/*` (endpoint modules)
  - `src/server/routes/middleware.ts` (auth middleware)
  - `src/server/ws-service.ts` (service-to-service ws endpoint)
  - `src/server/ha-client.ts` (shared HA fetch helper)
  - `src/server/db.ts` (SQLite access)
- Shared runtime:
  - `src/shared/homescript.ts` (engine)
  - `src/shared/execution-report.ts` (execution telemetry model)

## Environment Variables

Use `.env.example` as template.

Main variables:
- `NODE_ENV`
- `MOCK`
- `APP_URL`
- `JWT_SECRET`
- `SESSION_SECRET` (recommended)
- `AUTHENTIK_URL` or `AUTHENTIK_ISSUER`
- `AUTHENTIK_CLIENT_ID`
- `AUTHENTIK_CLIENT_SECRET`
- `HA_URL`
- `HA_TOKEN`
- `HA_TIMEOUT_MS` (optional, default `8000`)

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Configure environment:

```bash
cp .env.example .env
```

3. Run dev server:

```bash
npm run dev
```

Default app URL:
- `http://localhost:3000`

## Authentication Model

### UI/Admin
- `Authorization: Bearer <jwt>`

### Service-to-Service
- `x-service-id: <service_account_id>`
- `x-service-secret: <service_account_secret>`

Legacy compatibility:
- `x-service-key` still accepted.

## API Overview

### Configuration/Auth
- `GET /api/config`
- `GET /api/auth/url`
- `GET /api/auth/mock-login`
- `GET /api/auth/callback`
- `GET /api/auth/me`

### Home Assistant Proxy
- `GET /api/states`
- `GET /api/services`
- `POST /api/call_service`

### Service Accounts
- `GET /api/service-accounts`
- `POST /api/service-accounts`
- `DELETE /api/service-accounts/:id`

### Scripts
- `GET /api/scripts`
- `GET /api/scripts/:id`
- `POST /api/scripts`
- `PUT /api/scripts/:id`
- `DELETE /api/scripts/:id`

### Script Execution
- `POST /api/run/:endpoint` (authenticated)
- `POST /api/webhook/:endpoint` (webhook trigger)

## Service-to-Service HTTP Example

```bash
curl -X POST "http://localhost:3000/api/run/office-cooling" \
  -H "Content-Type: application/json" \
  -H "x-service-id: <service_account_id>" \
  -H "x-service-secret: <service_account_secret>" \
  -d '{"temperature":28}'
```

## Service-to-Service WebSocket

Endpoint:
- `ws://localhost:3000/api/ws/service`

### Message sequence

1. Server sends `ready`
2. Client sends `auth`
3. Server sends `auth_ok`
4. Client sends `run`
5. Server streams:
  - `run_started`
  - `run_event`
  - `ha_state`
  - `run_complete`

### Auth message

```json
{"type":"auth","serviceId":"<id>","serviceSecret":"<secret>"}
```

### Run message

```json
{"type":"run","endpoint":"office-cooling","variables":{"temperature":28},"requestId":"req-1"}
```

### Ping/Pong

Client:

```json
{"type":"ping","requestId":"p1"}
```

Server:

```json
{"type":"pong","requestId":"p1"}
```

## Production Build

Build frontend and backend ahead of time:

```bash
npm run build:prod
```

Outputs:
- `dist/` (frontend static assets)
- `dist-server/` (compiled backend)

Run production server:

```bash
npm start
```

No runtime TypeScript transpilation is used in production.

## Docker (Linux Production)

Build image:

```bash
docker build -t homescript-studio:prod .
```

Run container:

```bash
docker run --rm -p 3000:3000 --env-file .env homescript-studio:prod
```

Container design:
- multi-stage build,
- frontend + backend precompiled,
- production dependencies only at runtime.

## Quality Commands

- Type check:

```bash
npm run lint
```

- Tests:

```bash
npm run test
```

- Full production build:

```bash
npm run build:prod
```

## Additional Docs

- LLM usage guide:
  - `LLM_HOMESCRIPT_GUIDE.md`
- Home Assistant context:
  - `HA_CONTEXT.md`
- Working tracker:
  - `TODO.md`
