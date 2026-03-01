# HomeScript Common Library (`$COMMON`)

This document defines the built-in utility library available to HomeScript expressions.
It is intended for humans and LLM prompt injection.

## Availability

`$COMMON` is injected automatically by the runtime.
You do not need to define or import it.

Use it directly inside expressions:

```txt
SET $safe = $COMMON.math.clamp($temperature, 18, 26)
PRINT $COMMON.string.upper("status ok")
```

## API

### Math

- `$COMMON.math.abs(x)`
- `$COMMON.math.min(a, b, ...)`
- `$COMMON.math.max(a, b, ...)`
- `$COMMON.math.clamp(value, min, max)`
- `$COMMON.math.round(value, decimals)`
- `$COMMON.math.floor(x)`
- `$COMMON.math.ceil(x)`
- `$COMMON.math.sum(array)`
- `$COMMON.math.avg(array)`
- `$COMMON.math.between(value, min, max)` (inclusive)

### String

- `$COMMON.string.lower(text)`
- `$COMMON.string.upper(text)`
- `$COMMON.string.trim(text)`
- `$COMMON.string.contains(text, part)`
- `$COMMON.string.startsWith(text, part)`
- `$COMMON.string.endsWith(text, part)`
- `$COMMON.string.replaceAll(text, search, replacement)`
- `$COMMON.string.split(text, separator)` -> array

### Array

- `$COMMON.array.length(array)`
- `$COMMON.array.includes(array, value)` (string-safe comparison)
- `$COMMON.array.first(array)`
- `$COMMON.array.last(array)`
- `$COMMON.array.unique(array)`
- `$COMMON.array.compact(array)` (removes `null`, `undefined`, empty string)
- `$COMMON.array.join(array, separator)` -> string

## LLM Usage Notes

- Prefer `$COMMON` helpers over complex inline expressions.
- Keep scripts deterministic: transform input, then `IF`, then `SET/CALL`.
- Do not redefine `$COMMON`; treat it as read-only runtime API.
- When generating code, use these helpers to reduce boilerplate and avoid repeated logic.

## Example

```txt
REQUIRED $room
OPTIONAL $target = 22

GET sensor.office_temperature INTO $temperature
SET $tempSafe = $COMMON.math.clamp($temperature, 0, 60)

IF $COMMON.math.between($tempSafe, 24, 60)
  CALL climate.set_temperature({"entity_id":"climate.$room","temperature":$target})
  PRINT $COMMON.string.upper("cooling applied")
ELSE
  PRINT "No cooling required"
END_IF
```

