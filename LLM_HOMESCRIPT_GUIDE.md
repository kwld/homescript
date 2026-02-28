# LLM Friendly HomeScript Guide

This is a production-ready reference for generating, reviewing, and running HomeScript with LLMs.

## 1. Purpose

Use this guide to:
- generate valid HomeScript quickly,
- keep scripts predictable and debuggable,
- call scripts through the API with proper authentication.

## 2. Authentication (Required)

All authenticated script execution requests must include:
- `x-service-id`
- `x-service-secret`
- `Content-Type: application/json`

Example:

```bash
curl -X POST "https://your-host/api/run/lights-on" \
  -H "Content-Type: application/json" \
  -H "x-service-id: <service_account_id>" \
  -H "x-service-secret: <service_account_secret>" \
  -d '{"room":"kitchen"}'
```

Notes:
- `x-service-id` is visible in Service Accounts table.
- `x-service-secret` is shown once at credential creation.

## 3. HomeScript Syntax Rules

- Use uppercase keywords: `SET`, `PRINT`, `GET`, `CALL`, `IF`, `ELSE`, `END_IF`, `WHILE`, `DO`, `END_WHILE`, `FUNCTION`, `END_FUNCTION`, `IMPORT`, `RETURN`.
- Variables use `$name`.
- Comments start with `#`.
- Prefer one command per line.
- Always close control blocks (`END_IF`, `END_WHILE`, `END_FUNCTION`).

## 4. Core Commands

### SET

Set local variable:

```txt
SET $target = 22
```

Set entity state/value:

```txt
SET input_number.heating_target = 21
```

### PRINT

Emit line to execution output:

```txt
PRINT "Cooling enabled"
```

### GET

Read Home Assistant entity state into variable:

```txt
GET sensor.office_temperature INTO $temperature
```

### CALL

Call Home Assistant service:

```txt
CALL light.turn_on("light.kitchen")
CALL climate.set_temperature({"entity_id":"climate.office","temperature":22})
```

## 5. Flow Control

### IF / ELSE

```txt
IF $temperature > 25
  PRINT "Too warm"
ELSE
  PRINT "OK"
END_IF
```

### WHILE

```txt
SET $i = 0
WHILE $i < 3 DO
  PRINT $i
  SET $i = $i + 1
END_WHILE
```

## 6. Functions And Imports

Define a reusable function:

```txt
FUNCTION cool_if_needed($temp)
  IF $temp > 25
    CALL fan.turn_on("switch.office_fan")
  END_IF
END_FUNCTION
```

Call it:

```txt
CALL cool_if_needed($temperature)
```

Import another script by endpoint name:

```txt
IMPORT "shared-cooling-rules"
```

## 7. API Execution Model

### Run endpoint

- `POST /api/run/<endpoint>` (authenticated)
- body keys become script variables

Example body:

```json
{
  "temperature": 27,
  "room": "office"
}
```

Available in script as:
- `$temperature`
- `$room`

### Webhook endpoint

- `POST /api/webhook/<endpoint>`
- useful for external triggers

## 8. Debugging And Reliability

- Use `PRINT` checkpoints for traceability.
- Keep logic explicit; avoid deeply nested control flow.
- Read first, then act:
  1. `GET` state
  2. evaluate condition
  3. `SET` or `CALL`
- Keep side effects minimal and intentional.

## 9. Common Errors

- Missing `END_IF` / `END_WHILE` / `END_FUNCTION`.
- Invalid `CALL` format (must be `domain.service(...)`).
- Invalid `GET` format (must be `GET domain.entity INTO $var`).
- Invalid JSON payload in API request.
- Missing auth headers (`x-service-id`, `x-service-secret`).

## 10. LLM Prompt Template

Use this prompt when asking an LLM for script generation:

```txt
Generate HomeScript code only (no explanation).
Requirements:
- Use uppercase HomeScript keywords.
- One statement per line.
- Always close blocks with END_IF / END_WHILE / END_FUNCTION.
- Use explicit entity ids and payload keys.
- Include PRINT lines for important checkpoints.
- Keep logic deterministic and minimal.
Context variables:
- temperature (number)
- room (string)
Goal:
- If temperature > 25, set climate target to 22 and print success.
- Otherwise print no action.
```

## 11. Ready Example

```txt
GET sensor.office_temperature INTO $temperature
SET $target = 22

IF $temperature > 25
  CALL climate.set_temperature({"entity_id":"climate.office","temperature":$target})
  PRINT "Cooling applied"
ELSE
  PRINT "Temperature acceptable"
END_IF
```

## 12. Request Example With Auth

```bash
curl -X POST "https://your-host/api/run/office-cooling" \
  -H "Content-Type: application/json" \
  -H "x-service-id: <service_account_id>" \
  -H "x-service-secret: <service_account_secret>" \
  -d '{"temperature": 28, "room":"office"}'
```

