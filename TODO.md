# TODO Tracker

This file is the mandatory execution tracker for all agent work in this repository.

## Tracker Instructions
1. Start every task by adding it to `Planned` or `In Progress`.
2. Move a task to `In Progress` when implementation begins.
3. Keep notes short and factual while working.
4. Mark task `Done` only after implementation is complete.
5. For every completed task include:
   - Completion date (`YYYY-MM-DD`)
   - Files changed
   - One-line outcome summary

## Planned
- [ ] (empty)

## In Progress
- [ ] (empty)

## Done
- [x] Create strict `AGENTS.md` rules and set up mandatory `TODO.md` workflow.
  - Date: 2026-02-28
  - Files: `AGENTS.md`, `TODO.md`
  - Outcome: Enforced no popup/no modal policy, minimal component guidance, reuse-first rule, latest-library policy, and mandatory tracking protocol.
- [x] Analyze app architecture and build implementation context.
  - Date: 2026-02-28
  - Files: `package.json`, `server.ts`, `src/App.tsx`, `src/server/routes.ts`, `src/server/db.ts`, `src/pages/*`, `src/components/*`, `src/shared/*`, `.env.example`
  - Outcome: Mapped architecture, runtime flows, UX constraints, and key implementation risks with baseline test/type-check status.
- [x] Improve `Execution Output` console with full debug telemetry, state reporting, execution log, backend/frontend diagnostics, Home Assistant state visibility, and success/failure highlighting.
  - Date: 2026-02-28
  - Files: `src/shared/execution-report.ts`, `src/shared/homescript.ts`, `src/server/routes.ts`, `src/components/ExecutionConsole.tsx`, `src/pages/ScriptEditor.tsx`, `TODO.md`
  - Outcome: Added structured execution reports, engine trace events, HA activity reporting, and a tabbed console with status highlighting and debug controls.
- [x] Add a raw output console tab with clean print messages, place it next to logs, and default-select it.
  - Date: 2026-02-28
  - Files: `src/components/ExecutionConsole.tsx`, `TODO.md`
  - Outcome: Added `Raw` tab for print-only output, placed next to logs, and set as default active tab.
- [x] Improve Home Assistant connection error handling for timeout/fetch failures with clean logs and structured API errors.
  - Date: 2026-02-28
  - Files: `src/server/routes.ts`, `TODO.md`
  - Outcome: Added HA fetch timeout wrapper and normalized error reporting for states/services/service calls to avoid raw stack spam and provide clear connectivity failure messages.
- [x] Add sidebar menu entry for an LLM-friendly bot script guide with a dedicated page.
  - Date: 2026-02-28
  - Files: `src/App.tsx`, `src/pages/LLMHomeScriptGuide.tsx`, `TODO.md`
  - Outcome: Added new sidebar menu item and route for an LLM-friendly HomeScript guide page with prompt pattern, rules, and example script.
- [x] Move content scrollbar to the right edge of the main area instead of centered inner containers.
  - Date: 2026-02-28
  - Files: `src/App.tsx`, `src/pages/Guides.tsx`, `src/pages/LLMHomeScriptGuide.tsx`, `TODO.md`
  - Outcome: Main layout now owns vertical scrolling, and centered guide pages no longer render local scrollbars in the middle.
- [x] Add visible `x-service-id` and `x-service-secret` credentials flow in Service Accounts and backend auth support.
  - Date: 2026-02-28
  - Files: `src/server/db.ts`, `src/server/routes.ts`, `src/pages/ServiceAccounts.tsx`, `src/pages/Dashboard.tsx`, `TODO.md`
  - Outcome: Added dual-header service auth (`x-service-id` + `x-service-secret`) support, returned those fields from account creation, and updated UI to display/copy credentials and show Service ID in account list.
- [x] Expand LLM HomeScript guide with proper authentication usage and Markdown-style Monaco text block examples.
  - Date: 2026-02-28
  - Files: `src/pages/LLMHomeScriptGuide.tsx`, `TODO.md`
  - Outcome: Added dedicated auth section with required headers and a read-only Monaco Markdown block showing endpoint, curl example, and LLM prompt rules.
- [x] Add detailed HomeScript usage guidelines in the LLM guide page as a practical reference.
  - Date: 2026-02-28
  - Files: `src/pages/LLMHomeScriptGuide.tsx`, `TODO.md`
  - Outcome: Added a comprehensive HomeScript usage reference (syntax, commands, control flow, functions/imports, API model, debugging, and LLM generation rules) rendered in a read-only Monaco markdown block.
- [x] Create a full standalone `.md` LLM guide file for HomeScript usage.
  - Date: 2026-02-28
  - Files: `LLM_HOMESCRIPT_GUIDE.md`, `TODO.md`
  - Outcome: Added one complete ready-to-use markdown guide covering authentication, syntax, commands, API usage, debugging, LLM prompt template, and request examples.
- [x] Analyze Home Assistant instance from `.env`, verify latest official API references on the web, and create `HA_CONTEXT.md`.
  - Date: 2026-02-28
  - Files: `HA_CONTEXT.md`, `TODO.md`
  - Outcome: Probed live HA instance (version/connectivity/services/states), cross-checked official API/changelog sources, and documented current coverage plus gaps for full HA API support.
- [x] Create a proper project `.gitignore`, add it, and commit.
  - Date: 2026-02-28
  - Files: `.gitignore`, `TODO.md`
  - Outcome: Added complete ignore rules for dependencies, build/test artifacts, logs, env secrets, local databases, and editor/OS files.
- [x] Fully implement app-side WebSocket service-to-service execution and document protocol for LLMs and README.
  - Date: 2026-02-28
  - Files: `server.ts`, `README.md`, `LLM_HOMESCRIPT_GUIDE.md`, `TODO.md`
  - Outcome: Added authenticated `/api/ws/service` execution channel with streamed run/HA events and documented full protocol and examples for human and LLM usage.
- [x] Refactor oversized server bootstrap into proper server modules (routing/components style) and keep behavior unchanged.
  - Date: 2026-02-28
  - Files: `server.ts`, `src/server/ws-service.ts`, `src/server/ha-client.ts`, `src/server/routes.ts`, `TODO.md`
  - Outcome: Reduced `server.ts` to clean bootstrap, extracted WS service implementation and shared HA client utility into dedicated server modules.
- [x] Split monolithic routes into dedicated endpoint modules under route folders.
  - Date: 2026-02-28
  - Files: `src/server/routes.ts`, `src/server/routes/types.ts`, `src/server/routes/middleware.ts`, `src/server/routes/endpoints/*`, `TODO.md`
  - Outcome: Broke route handling into focused endpoint modules (auth/config/ha/service-accounts/scripts/run/webhook) with shared context and auth middleware.
- [x] Add production-ready precompiled build and Docker setup (no dev deps at runtime, no on-the-fly TS compile).
  - Date: 2026-02-28
  - Files: `tsconfig.server.json`, `package.json`, `Dockerfile`, `.dockerignore`, `.gitignore`, `README.md`, `server.ts`, `src/server/routes.ts`, `src/server/routes/*`, `src/server/ws-service.ts`, `src/server/ha-client.ts`, `TODO.md`
  - Outcome: Added full ahead-of-time production build for frontend/server, Linux multi-stage Docker runtime with production deps only, and modularized server routing/runtime components.
