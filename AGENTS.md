# Agent Instructions

These rules are strict and apply to every change in this repository.

## 1) UI/UX Hard Rules
- Never use browser-native popups: no `alert()`, `confirm()`, or `prompt()`.
- Never use browser modals of any kind.
- Use inline feedback only:
  - Inline error messages near fields/actions.
  - Inline confirmation controls/buttons.
  - Inline banners/status blocks.
- If a flow currently uses popups/modals, refactor it to inline UX.

## 2) Component and File Size Rules
- Keep changes minimal and composable.
- Prefer small focused components over large files.
- Reuse existing components before creating new ones.
- If a new component is necessary:
  - Keep it single-purpose.
  - Place it in the existing component structure.
  - Avoid duplicate UI patterns that already exist.

## 3) Dependency Rules
- Prefer current stable library versions.
- Before adding/updating a dependency:
  - Confirm it is actively maintained.
  - Keep upgrades scoped to the task.
  - Avoid dependency churn without product value.

## 4) Work Tracking is Mandatory
- Every task must be tracked in `TODO.md`.
- Update `TODO.md` at these points:
  - Before work: add task in `Planned` or `In Progress`.
  - During work: update status and short notes.
  - After work: move to `Done` with date and changed files.
- Do not finish a task without updating `TODO.md`.

## 5) Delivery Checklist (Required)
- No popup/modal usage introduced.
- Minimal component footprint.
- Existing components reused where possible.
- Any library changes are justified and stable.
- `TODO.md` updated to reflect real progress and completion.
