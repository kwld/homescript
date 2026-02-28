<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# HomeScript Studio

HomeScript Studio provides:
- HomeScript authoring and execution,
- service-to-service authentication,
- Home Assistant integration,
- HTTP and WebSocket execution modes.

## Run Locally

Prerequisites: Node.js

1. Install dependencies: `npm install`
2. Configure `.env` (keep `.env.example` as template)
3. Start app: `npm run dev`

Server defaults to `http://localhost:3000`.

## Service-to-Service Authentication

Use service account credentials in headers:
- `x-service-id: <service_account_id>`
- `x-service-secret: <service_account_secret>`

Legacy compatibility:
- `x-service-key` is still accepted.

## HTTP Script Execution

Authenticated run endpoint:

```bash
curl -X POST "http://localhost:3000/api/run/<endpoint>" \
  -H "Content-Type: application/json" \
  -H "x-service-id: <service_account_id>" \
  -H "x-service-secret: <service_account_secret>" \
  -d '{"temperature":27}'
```

Webhook endpoint (no service credential auth required by design):

```bash
curl -X POST "http://localhost:3000/api/webhook/<endpoint>" \
  -H "Content-Type: application/json" \
  -d '{"source":"external"}'
```

## WebSocket Service-to-Service Execution

Endpoint:
- `ws://localhost:3000/api/ws/service`

### Message Flow

1. Server sends:
- `{"type":"ready","message":"..."}`  

2. Client authenticates:

```json
{"type":"auth","serviceId":"<id>","serviceSecret":"<secret>"}
```

Legacy auth message:

```json
{"type":"auth","apiKey":"<legacy_key>"}
```

3. On success server sends:
- `{"type":"auth_ok","serviceId":"...","serviceName":"..."}`  

4. Client requests run:

```json
{"type":"run","endpoint":"office-cooling","variables":{"temperature":28},"requestId":"req-1"}
```

5. Server streams lifecycle:
- `run_started`
- `run_event` (engine telemetry)
- `ha_state` (HA GET/SET/CALL status)
- `run_complete` (success/error + output + variables)

### Ping/Pong

Client:
```json
{"type":"ping","requestId":"p1"}
```

Server:
```json
{"type":"pong","requestId":"p1"}
```

## Production Build (No On-The-Fly TS Compile)

Build everything ahead of time:

```bash
npm run build:prod
```

This creates:
- frontend static assets in `dist/`
- compiled server/runtime files in `dist-server/`

Run production server:

```bash
npm start
```

No `tsx` or runtime TypeScript transpilation is used in production.

## Docker (Linux, Production-Ready)

Build image:

```bash
docker build -t homescript-studio:prod .
```

Run container:

```bash
docker run --rm -p 3000:3000 --env-file .env homescript-studio:prod
```

Container behavior:
- Multi-stage build
- Compiles frontend + server during build stage
- Installs production dependencies only in runtime stage (`npm ci --omit=dev`)
- Starts with `node dist-server/server.js`

## Backend Structure

Production backend is modular:
- Bootstrap: `server.ts`
- Route assembler: `src/server/routes.ts`
- Route modules: `src/server/routes/endpoints/*`
- Shared middleware/context: `src/server/routes/middleware.ts`, `src/server/routes/types.ts`
- HA client helper: `src/server/ha-client.ts`
- WS service runner: `src/server/ws-service.ts`
