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
- [x] Rewrite `README.md` completely with up-to-date project documentation.
  - Date: 2026-02-28
  - Files: `README.md`, `TODO.md`
  - Outcome: Replaced README with a complete project guide covering architecture, auth, API usage, WebSocket protocol, production build, Docker, and quality commands.
- [x] Create a security audit document and add automated security tests.
  - Date: 2026-02-28
  - Files: `SECURITY_AUDIT.md`, `src/server/routes/middleware.test.ts`, `TODO.md`
  - Outcome: Added formal security audit with prioritized findings and introduced security-focused middleware tests validating JWT/service credential authorization paths.
- [x] Implement HA state-change trigger watcher with Script Editor trigger configuration and graph-based threshold levels.
  - Date: 2026-02-28
  - Files: `src/shared/trigger-config.ts`, `src/server/db.ts`, `src/server/ha-event-engine.ts`, `server.ts`, `src/server/routes/endpoints/scripts.ts`, `src/components/EventTriggerConfigurator.tsx`, `src/pages/ScriptEditor.tsx`, `package.json`, `package-lock.json`, `TODO.md`
  - Outcome: Added configurable per-script event triggers (toggle/any-change/sensor levels), draggable graph threshold UI, persisted trigger config, and HA websocket watcher that injects `$event.name` and `$event.value` during auto-execution.
- [x] Populate trigger graph with real Home Assistant historical data.
  - Date: 2026-02-28
  - Files: `src/server/routes/endpoints/ha.ts`, `src/pages/ScriptEditor.tsx`, `src/components/EventTriggerConfigurator.tsx`, `TODO.md`
  - Outcome: Added authenticated HA history API proxy and wired Script Editor sensor trigger graph to render real recent history with inline loading/error status.
- [x] Fix history graph JSON parsing error when API returns HTML fallback.
  - Date: 2026-02-28
  - Files: `server.ts`, `src/pages/ScriptEditor.tsx`, `TODO.md`
  - Outcome: Added `/api/*` JSON 404 fallback and robust history response parsing to prevent `Unexpected token '<'` and surface actionable inline errors.
- [x] Add tests for history response parsing failures and validate HA history payload shape from runtime call.
  - Date: 2026-02-28
  - Files: `src/shared/history.ts`, `src/shared/history.test.ts`, `src/pages/ScriptEditor.tsx`, `TODO.md`
  - Outcome: Added parser unit tests (valid JSON, HTML fallback, invalid format) and confirmed live HA `/api/history/period` returns JSON series shape compatible with graph mapping.
- [x] Harden history parser for empty/nonstandard successful responses and raw HA array payloads.
  - Date: 2026-02-28
  - Files: `src/shared/history.ts`, `src/shared/history.test.ts`, `TODO.md`
  - Outcome: Added tolerant parsing for empty 2xx bodies and raw HA history shape so graph loads instead of failing with invalid response errors.
- [x] Fix trigger graph readability and align draggable level behavior with real historical value scale.
  - Date: 2026-02-28
  - Files: `src/components/EventTriggerConfigurator.tsx`, `TODO.md`
  - Outcome: Applied high-contrast tooltip styling, chart-domain auto-fit to historical values, and drag-edge behavior that expands range up/down with below-chart drop-to-remove threshold.
- [x] Smooth drag edge-expansion and normalize min/max range on drop.
  - Date: 2026-02-28
  - Files: `src/components/EventTriggerConfigurator.tsx`, `TODO.md`
  - Outcome: Replaced jumpy edge growth with throttled small expansion steps during drag and auto-adjusted range to true data+level bounds when drag ends.
- [x] Add logarithmic preview option and fix cursor/handle misalignment during edge-extension drag.
  - Date: 2026-02-28
  - Files: `src/components/EventTriggerConfigurator.tsx`, `src/shared/trigger-config.ts`, `src/server/ha-event-engine.ts`, `TODO.md`
  - Outcome: Added selectable linear/log preview scale (with safe fallback), and updated edge-extension drag logic to map handle value from cursor position after each range update to keep drag alignment stable.
- [x] Replace single trigger toggle with multi-rule builder and AND/OR logic.
  - Date: 2026-02-28
  - Files: `src/shared/trigger-config.ts`, `src/components/EventTriggerConfigurator.tsx`, `src/pages/ScriptEditor.tsx`, `src/server/ha-event-engine.ts`, `TODO.md`
  - Outcome: Implemented rule list builder (add/remove/enable/edit), group logic selector (AND/OR), per-rule event settings and graph levels, plus backend evaluation of enabled rules with legacy trigger-config migration support.
- [x] Remove per-rule toggles and add Monaco rule-expression engine using rule-name variables.
  - Date: 2026-02-28
  - Files: `src/shared/trigger-config.ts`, `src/components/EventTriggerConfigurator.tsx`, `src/server/ha-event-engine.ts`, `src/pages/ScriptEditor.tsx`, `TODO.md`
  - Outcome: Rules now work by existence in list, added expression editor for `$RULE_NAME` with AND/OR/NOT logic, and backend now validates each rule per state-change then evaluates custom expression (or fallback group logic).
- [x] Add rule debugger with fake event data, syntax-highlighted rule input, and expand Script Editor Monaco workspace height.
  - Date: 2026-02-28
  - Files: `src/components/EventTriggerConfigurator.tsx`, `src/pages/ScriptEditor.tsx`, `src/shared/trigger-config.ts`, `TODO.md`
  - Outcome: Added local rule debugger (fake entity/old/new state evaluation), switched rule-expression Monaco to HomeScript highlighting, introduced debug data modes (manual/preset/randomized), and constrained top config panel so the main HomeScript editor keeps ~80vh workspace.
- [x] Style global scrollbars and move rule builder into a dropdown below script editor.
  - Date: 2026-02-28
  - Files: `src/index.css`, `src/pages/ScriptEditor.tsx`, `TODO.md`
  - Outcome: Added app-wide custom scrollbar theming and refactored Script Editor layout to remove top split panel, placing trigger/rule configuration in a collapsible dropdown below Monaco.
- [x] Add toggle transition `From`/`To` rule matching and hide sensor-only controls for non-sensor rules.
  - Date: 2026-02-28
  - Files: `src/shared/trigger-config.ts`, `src/components/EventTriggerConfigurator.tsx`, `src/server/ha-event-engine.ts`, `TODO.md`
  - Outcome: Added per-toggle transition filters (`any/on/off` -> `any/on/off`) in UI and backend evaluator, and removed irrelevant Preview Scale/Range controls from toggle and any-change rule types.
- [x] Implement popup entity selector with filters, current state preview, and mini history graph.
  - Date: 2026-02-28
  - Files: `src/components/EntitySelectorPopup.tsx`, `src/components/EventTriggerConfigurator.tsx`, `src/pages/ScriptEditor.tsx`, `TODO.md`
  - Outcome: Added reusable entity picker popup with search/domain/historic filters, selected entity state details, and historical sparkline preview when available; integrated into rule `Entity` field.
- [x] Add multiline HomeScript IF condition parsing and reuse shared parser for event IF wrapper evaluation.
  - Date: 2026-02-28
  - Files: `src/shared/homescript.ts`, `src/shared/homescript/expression.ts`, `src/shared/homescript/if-condition.ts`, `src/server/ha-event-engine.ts`, `src/components/EventTriggerConfigurator.tsx`, `src/shared/homescript.test.ts`, `TODO.md`
  - Outcome: Split parser logic into reusable shared modules, enabled multiline IF condition continuation in HomeScript engine, and switched event expression validation/evaluation to the same parser path used by HomeScript execution.
