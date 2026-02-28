import { describe, it, expect } from "vitest";
import { HomeScriptEngine, HomeScriptError } from "./homescript.js";

describe("HomeScriptEngine", () => {
  it("should execute PRINT", async () => {
    const engine = new HomeScriptEngine();
    const result = await engine.execute('PRINT "Hello World"');
    expect(result.output).toEqual(["Hello World"]);
  });

  it("should interpolate variables inside quoted PRINT strings", async () => {
    const engine = new HomeScriptEngine({ variables: { state: "off" } });
    const result = await engine.execute('PRINT "AC IS $state"');
    expect(result.output).toEqual(["AC IS off"]);
  });

  it("should execute SET and use variables", async () => {
    const engine = new HomeScriptEngine();
    const result = await engine.execute(`
      SET $x = 10
      PRINT $x
    `);
    expect(result.variables.x).toBe(10);
    expect(result.output).toEqual(["10"]);
  });

  it("should handle IF statements", async () => {
    const engine = new HomeScriptEngine();
    const result = await engine.execute(`
      SET $x = 5
      IF $x > 3
        PRINT "Greater"
      ELSE
        PRINT "Lesser"
      END_IF
    `);
    expect(result.output).toEqual(["Greater"]);
  });

  it("should handle multiline IF conditions with HomeScript operators", async () => {
    const engine = new HomeScriptEngine();
    const result = await engine.execute(`
      IF 1=1 AND
         1=1 OR
         false
        PRINT "Multiline works"
      END_IF
    `);
    expect(result.output).toEqual(["Multiline works"]);
  });

  it("should handle WHILE loops", async () => {
    const engine = new HomeScriptEngine();
    const result = await engine.execute(`
      SET $i = 0
      WHILE $i < 3 DO
        PRINT $i
        SET $i = $i + 1
      END_WHILE
    `);
    expect(result.output).toEqual(["0", "1", "2"]);
    expect(result.variables.i).toBe(3);
  });

  it("should handle CALL", async () => {
    const engine = new HomeScriptEngine();
    const result = await engine.execute(`
      SET $entity = "light.living_room"
      CALL homeassistant.turn_on($entity)
    `);
    expect(result.output[0]).toContain("homeassistant.turn_on");
    expect(result.output[0]).toContain("light.living_room");
  });

  it("should handle GET", async () => {
    const engine = new HomeScriptEngine({
      onGet: async (entityId) => {
        if (entityId === "sensor.temperature") return 22;
        return "unknown";
      }
    });
    const result = await engine.execute(`
      GET sensor.temperature INTO $temp
      PRINT $temp
    `);
    expect(result.variables.temp).toBe(22);
    expect(result.output).toEqual(["22"]);
  });

  it("should expose built-in $ENUMS values", async () => {
    const onSetCalls: Array<{ entityId: string; state: any }> = [];
    const engine = new HomeScriptEngine({
      onSet: async (entityId, state) => {
        onSetCalls.push({ entityId, state });
      },
    });
    await engine.execute(`SET light.test = $ENUMS.state.off`);
    expect(onSetCalls).toEqual([{ entityId: "light.test", state: "off" }]);
  });

  it("should throw error on invalid syntax", async () => {
    const engine = new HomeScriptEngine();
    await expect(engine.execute('INVALID_KEYWORD')).rejects.toThrow(HomeScriptError);
  });
});
