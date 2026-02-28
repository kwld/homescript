import { describe, expect, it } from "vitest";
import { validateHomeScript } from "./homescript/validation.js";

describe("validateHomeScript TEST diagnostics", () => {
  it("should accept valid TEST statements", () => {
    const diagnostics = validateHomeScript(`
      TEST $name /abc/i INTO $ok
      TEST /[0-9]+/ "42"
    `);
    expect(diagnostics).toEqual([]);
  });

  it("should flag TEST missing regex literal", () => {
    const diagnostics = validateHomeScript(`
      TEST $value INTO $ok
    `);
    expect(diagnostics.some((d) => d.message.includes("TEST requires regex literal"))).toBe(true);
  });

  it("should flag malformed TEST statements without regex operand", () => {
    const diagnostics = validateHomeScript(`
      TEST INTO $ok
    `);
    expect(diagnostics.some((d) => d.message.includes("TEST requires regex literal"))).toBe(true);
  });
});
