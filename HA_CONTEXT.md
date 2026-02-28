# Home Assistant Context (Instance + API Coverage)

Generated: 2026-02-28  
Scope: local instance analysis from `.env` + latest official Home Assistant API references.

## 1. Instance Profile (from `.env` + live probe)

- `HA_URL` configured: `http://homeassistant.local:8123`
- `HA_TOKEN`: present (not exposed in this document)
- Home Assistant version: `2026.2.3`
- Location name: `Home`
- Time zone: `Europe/Warsaw`

Live endpoint checks:
- `GET /api/` -> `200 OK`
- `GET /api/config` -> `200 OK`
- `GET /api/services` -> `200 OK` (`68` domains)
- `GET /api/states` -> `200 OK` (`386` entities)

Interpretation:
- Instance is reachable from this app runtime.
- Token is valid for REST API access.
- Service/action and state inventory are large enough for advanced script orchestration.

## 2. Authentication Model In This Project

There are two auth layers in this app:

1. Client -> this app API:
- `Authorization: Bearer <jwt>` (UI/admin flows)
- or service credentials:
  - `x-service-id: <service_account_id>`
  - `x-service-secret: <service_account_secret>`
- legacy compatibility: `x-service-key` still accepted

2. This app -> Home Assistant:
- `Authorization: Bearer <HA_TOKEN>`
- Uses HA REST API and HA WebSocket API.

## 3. Current Home Assistant API Coverage In Code

Implemented currently:

- REST:
  - `GET /api/states`
  - `GET /api/states/<entity_id>`
  - `POST /api/states/<entity_id>` (fallback state set path)
  - `GET /api/services`
  - `POST /api/services/<domain>/<service>`
  - `GET /api/config`

- WebSocket:
  - Connect to `/api/websocket`
  - Auth handshake (`auth_required` -> `auth` -> `auth_ok`)
  - Commands used:
    - `get_states`
    - `get_services`
    - `call_service`

Runtime integration behavior:
- `GET` in HomeScript reads entity state via HA API.
- `CALL` in HomeScript maps to HA service calls.
- `SET <entity> = <value>` maps to either:
  - domain-specific service calls (`turn_on`, `turn_off`, etc.), or
  - REST state update fallback.

## 4. Reliability And Error Handling Context

Server now uses timeout-aware HA fetch handling:
- Default timeout: `HA_TIMEOUT_MS` (fallback `8000ms`)
- Normalized connectivity errors:
  - timeout (`ETIMEDOUT` / abort)
  - host not found (`ENOTFOUND`)
  - connection refused (`ECONNREFUSED`)

Effect:
- Faster failure detection.
- Cleaner logs and API error messages.

## 5. Latest Upstream References (Official)

Checked against official Home Assistant docs/changelog:

- REST API docs:  
  https://developers.home-assistant.io/docs/api/rest
- WebSocket API docs:  
  https://developers.home-assistant.io/docs/api/websocket
- Auth API (long-lived access tokens):  
  https://developers.home-assistant.io/docs/auth_api
- Auth overview:  
  https://developers.home-assistant.io/docs/auth_index/
- 2026.2 release notes blog:  
  https://www.home-assistant.io/blog/2026/02/04/release-20262/
- 2026.2 full changelog:  
  https://www.home-assistant.io/changelogs/core-2026.2

Observed version context:
- Your instance reports `2026.2.3`.
- Public changelog page currently lists `2026.2.2` as latest displayed patch in that page snapshot.
- Treat this as a normal timing mismatch between running instance and indexed docs/changelog snapshots.

## 6. Gaps To Reach “Full HA API Coverage”

Not yet covered in this app but useful for broader HA automation support:

- History/recorder access:
  - `/api/history/period`
  - `/api/logbook`
- Event bus operations:
  - REST `POST /api/events/<event_type>`
  - WS `subscribe_events`, `fire_event`
- Template execution:
  - `/api/template`
- Config and diagnostics:
  - `/api/config/*` (beyond basic read)
  - `/api/error_log`
- Advanced service targeting:
  - WS target extraction and target-driven service discovery commands
- Area/device/label aware workflows:
  - richer metadata-driven service routing

## 7. Suggested Next Implementation Sequence

1. Add REST support for history/logbook/template endpoints.
2. Add WS event subscriptions (`state_changed`, custom events) to enable reactive scripts.
3. Add typed API wrappers for all used HA endpoints in one shared module.
4. Add entity/service capability cache with periodic refresh.
5. Add integration tests that validate calls against this live instance profile.

## 8. Security Notes

- Do not store `HA_TOKEN` in client-visible state unless intentionally required.
- Keep service secrets one-time visible in UI (already done).
- Prefer server-side HA calls for privileged operations.

