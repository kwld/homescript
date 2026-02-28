# HomeScript Improvement Tracker

## 🚀 Current Focus: Editor Experience (DX)
Goal: Make writing HomeScript easier and less error-prone by implementing proper language support in the editor.

### 1. Syntax Highlighting & Language Support
- [x] **Register Custom Language**: Define `homescript` language in Monaco Editor.
- [x] **Tokenizer (Syntax Highlighting)**:
  - [x] Keywords (`IF`, `ELSE`, `END_IF`, `WHILE`, `DO`, `END_WHILE`, `SET`, `PRINT`, `CALL`) - *Bold/Color*
  - [x] Variables (`$variableName`) - *Distinct Color*
  - [x] Strings (`"value"`) - *String Color*
  - [x] Comments (`# comment`) - *Grey/Italic*
  - [x] Numbers - *Number Color*
- [x] **Autocompletion (IntelliSense)**:
  - [x] Keywords suggestions.
  - [x] Snippets for blocks (e.g., `IF` expands to `IF ... END_IF`).
  - [x] Mock Service suggestions for `CALL` (e.g., `homeassistant.turn_on`).

---

## 📋 Backlog

### 2. Language Features
- [x] **Functions**: Support defining custom functions/subroutines.
- [x] **Math Operations**: Better support for complex math expressions in `SET`.
- [x] **Array/Object Support**: Better handling of JSON objects in variables.
- [x] **Imports**: Ability to import other scripts.

### 3. Runtime & Debugging
- [x] **Step-by-Step Debugging**: Ability to pause execution and inspect variables.
- [x] **Breakpoints**: Visual breakpoints in the editor.
- [x] **Better Error Reporting**: Highlight the exact error line in the editor with a red squiggly line.

### 4. Integration
- [x] **Real Home Assistant Integration**: Connect to a real HA instance via WebSocket or REST API.
- [x] **Webhook Triggers**: Allow scripts to be triggered via external webhooks.
- [ ] **Cron Schedules**: Built-in scheduler for scripts.

### 6. Entities & State Management
- [x] **GET Command**: Add `GET <entity_id> INTO $<var>` to HomeScript.
- [x] **State API**: Add `/api/states` to fetch all entities from Home Assistant.
- [x] **Entities Page**: Add a new page to the sidebar to list and categorize devices/entities/services.
- [x] **Command Palette**: Ensure statuses are clearly visible and up-to-date in the ctrl+k menu.

---

## ✅ Done
- [x] Basic Execution Engine (Server & Client)
- [x] Variable Support (`SET`)
- [x] Control Flow (`IF`, `WHILE`)
- [x] Service Calls (`CALL`)
- [x] Web Interface for Editing
