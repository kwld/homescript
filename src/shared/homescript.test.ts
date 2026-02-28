import { describe, it, expect } from "vitest";
import { HomeScriptEngine, HomeScriptError } from "./homescript.js";

describe("HomeScriptEngine", () => {
  it("should execute PRINT", async () => {
    const engine = new HomeScriptEngine();
    const result = await engine.execute('PRINT "Hello World"');
    expect(result.output).toEqual(["Hello World"]);
  });

  it("should support PRINT expression output", async () => {
    const engine = new HomeScriptEngine({ variables: { a: 3, b: 4 } });
    const result = await engine.execute("PRINT $a + $b");
    expect(result.output).toEqual(["7"]);
  });

  it("should support arrays and IN operator", async () => {
    const engine = new HomeScriptEngine();
    const result = await engine.execute(`
      SET $states = ["off", "on", "unknown"]
      PRINT "on" IN $states
      PRINT "idle" IN $states
    `);
    expect(result.output).toEqual(["true", "false"]);
  });

  it("should support IN with nested variable paths", async () => {
    const engine = new HomeScriptEngine({
      variables: { event: { name: "toggle" }, names: ["toggle", "changed"] },
    });
    const result = await engine.execute(`PRINT $event.name IN $names`);
    expect(result.output).toEqual(["true"]);
  });

  it("should support IN against object keys", async () => {
    const engine = new HomeScriptEngine();
    const result = await engine.execute(`
      SET $payload = {"mode":"auto","target":22}
      PRINT "mode" IN $payload
      PRINT "missing" IN $payload
    `);
    expect(result.output).toEqual(["true", "false"]);
  });

  it("should interpolate variables inside quoted PRINT strings", async () => {
    const engine = new HomeScriptEngine({ variables: { state: "off" } });
    const result = await engine.execute('PRINT "AC IS $state"');
    expect(result.output).toEqual(["AC IS off"]);
  });

  it("should support TEST with either operand order and INTO", async () => {
    const engine = new HomeScriptEngine({ variables: { value: "Hello World" } });
    const result = await engine.execute(`
      TEST $value /world/i INTO $m1
      TEST /hello/i $value INTO $m2
      PRINT $m1
      PRINT $m2
    `);
    expect(result.output).toEqual(["true", "true"]);
  });

  it("should expose TEST result in default $TEST variable", async () => {
    const engine = new HomeScriptEngine();
    const result = await engine.execute(`
      TEST "sample" /amp/
      PRINT $TEST
    `);
    expect(result.output).toEqual(["true"]);
  });

  it("should allow TEST with regex-first order and no match", async () => {
    const engine = new HomeScriptEngine();
    const result = await engine.execute(`
      TEST /abc/ "zzz" INTO $ok
      PRINT $ok
    `);
    expect(result.output).toEqual(["false"]);
  });

  it("should support TEST with escaped regex and character classes", async () => {
    const engine = new HomeScriptEngine({ variables: { value: "id-42" } });
    const result = await engine.execute(`
      TEST $value /^[a-z]+\\-[0-9]+$/i INTO $valid
      PRINT $valid
    `);
    expect(result.output).toEqual(["true"]);
  });

  it("should throw on invalid TEST syntax", async () => {
    const engine = new HomeScriptEngine();
    await expect(engine.execute(`TEST $value INTO $ok`)).rejects.toThrow("Invalid TEST syntax");
  });

  it("should throw on invalid TEST regex literal", async () => {
    const engine = new HomeScriptEngine();
    await expect(engine.execute(`TEST "abc" /(/ INTO $ok`)).rejects.toThrow("Invalid regex");
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

  it("should set entity state through onSet", async () => {
    const setCalls: Array<{ id: string; state: any }> = [];
    const engine = new HomeScriptEngine({
      onSet: async (id, state) => {
        setCalls.push({ id, state });
      },
      variables: { level: 25 },
    });
    await engine.execute(`SET light.office = $level + 5`);
    expect(setCalls).toEqual([{ id: "light.office", state: 30 }]);
  });

  it("should provide dry-run output for SET entity without onSet", async () => {
    const engine = new HomeScriptEngine();
    const result = await engine.execute(`SET light.office = "off"`);
    expect(result.output[0]).toContain("[Dry Run] SET light.office = off");
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

  it("should handle ELSE IF chain", async () => {
    const engine = new HomeScriptEngine({ variables: { x: 2 } });
    const result = await engine.execute(`
      IF $x = 1
        PRINT "one"
      ELSE IF $x = 2
        PRINT "two"
      ELSE
        PRINT "other"
      END_IF
    `);
    expect(result.output).toEqual(["two"]);
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

  it("should handle BREAK in WHILE loop", async () => {
    const engine = new HomeScriptEngine();
    const result = await engine.execute(`
      SET $i = 0
      WHILE $i < 10 DO
        IF $i = 3
          BREAK
        END_IF
        PRINT $i
        SET $i = $i + 1
      END_WHILE
    `);
    expect(result.output).toEqual(["0", "1", "2"]);
  });

  it("should handle CONTINUE in WHILE loop", async () => {
    const engine = new HomeScriptEngine();
    const result = await engine.execute(`
      SET $i = 0
      WHILE $i < 5 DO
        SET $i = $i + 1
        IF $i = 3
          CONTINUE
        END_IF
        PRINT $i
      END_WHILE
    `);
    expect(result.output).toEqual(["1", "2", "4", "5"]);
  });

  it("should detect infinite loops", async () => {
    const engine = new HomeScriptEngine();
    await expect(
      engine.execute(`
        WHILE true DO
          PRINT "loop"
        END_WHILE
      `)
    ).rejects.toThrow("Infinite loop detected");
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

  it("should call service through onCall", async () => {
    const calls: Array<{ svc: string; args: any[] }> = [];
    const engine = new HomeScriptEngine({
      onCall: async (svc, args) => {
        calls.push({ svc, args });
        return { ok: true };
      },
    });
    await engine.execute(`CALL light.turn_on("light.desk")`);
    expect(calls).toEqual([{ svc: "light.turn_on", args: ["light.desk"] }]);
  });

  it("should throw when onCall fails", async () => {
    const engine = new HomeScriptEngine({
      onCall: async () => {
        throw new Error("service failed");
      },
    });
    await expect(engine.execute(`CALL light.turn_on("light.desk")`)).rejects.toThrow("CALL failed: service failed");
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

  it("should provide dry-run behavior for GET without onGet", async () => {
    const engine = new HomeScriptEngine();
    const result = await engine.execute(`
      GET sensor.temperature INTO $temp
      PRINT $temp
    `);
    expect(result.variables.temp).toBeNull();
    expect(result.output).toEqual(["[Dry Run] GET sensor.temperature INTO $temp", "null"]);
  });

  it("should support FUNCTION call with args", async () => {
    const engine = new HomeScriptEngine({ variables: { x: 100 } });
    const result = await engine.execute(`
      FUNCTION addAndPrint(a,b)
        SET $x = $a + $b
        PRINT $x
      END_FUNCTION

      CALL addAndPrint(2,3)
      PRINT $x
    `);
    expect(result.output).toEqual(["5", "5"]);
  });

  it("should support RETURN inside FUNCTION", async () => {
    const engine = new HomeScriptEngine();
    const result = await engine.execute(`
      FUNCTION test()
        PRINT "before"
        RETURN
        PRINT "after"
      END_FUNCTION
      CALL test()
    `);
    expect(result.output).toEqual(["before"]);
  });

  it("should throw when calling function with wrong argument count", async () => {
    const engine = new HomeScriptEngine();
    await expect(
      engine.execute(`
        FUNCTION onlyOne(a)
          PRINT $a
        END_FUNCTION
        CALL onlyOne(1,2)
      `)
    ).rejects.toThrow("expects 1 arguments, got 2");
  });

  it("should support IMPORT and avoid duplicate imports", async () => {
    let imported = 0;
    const engine = new HomeScriptEngine({
      importCallback: async (name) => {
        imported += 1;
        if (name === "shared") return 'PRINT "from import"';
        throw new Error("not found");
      },
    });
    const result = await engine.execute(`
      IMPORT "shared"
      IMPORT "shared"
    `);
    expect(imported).toBe(1);
    expect(result.output).toContain("from import");
  });

  it("should throw when IMPORT fails", async () => {
    const engine = new HomeScriptEngine({
      importCallback: async () => {
        throw new Error("missing file");
      },
    });
    await expect(engine.execute(`IMPORT "x"`)).rejects.toThrow("Failed to import 'x': missing file");
  });

  it("should support debugger stop action at breakpoint", async () => {
    const breakpointCalls: number[] = [];
    const engine = new HomeScriptEngine({
      debug: true,
      breakpoints: [2],
      onBreakpoint: async (line) => {
        breakpointCalls.push(line);
        return "STOP";
      },
    });
    await expect(
      engine.execute(`
        PRINT "before"
        PRINT "breakpoint"
      `)
    ).rejects.toThrow("Debugger stopped");
    expect(breakpointCalls).toEqual([2]);
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

  it("should inject REQUIRED and OPTIONAL variables from query params", async () => {
    const engine = new HomeScriptEngine({
      queryParams: { mode: "night" },
    });
    const result = await engine.execute(`
      REQUIRED $mode
      OPTIONAL $missing
      PRINT "mode=$mode missing=$missing"
    `);
    expect(result.output).toEqual(["mode=night missing="]);
  });

  it("should fail REQUIRED when query param is missing", async () => {
    const engine = new HomeScriptEngine({ queryParams: {} });
    await expect(
      engine.execute(`
        REQUIRED $mode
        PRINT $mode
      `),
    ).rejects.toThrow("Missing required query variable: mode");
  });

  it("should enforce REQUIRED/OPTIONAL declarations at top of script", async () => {
    const engine = new HomeScriptEngine({ queryParams: { mode: "x" } });
    await expect(
      engine.execute(`
        PRINT "start"
        REQUIRED $mode
      `),
    ).rejects.toThrow("must be at the top of script");
  });

  it("should support LABEL and GOTO", async () => {
    const engine = new HomeScriptEngine();
    const result = await engine.execute(`
      LABEL start
      PRINT "A"
      GOTO end
      PRINT "B"
      LABEL end
      PRINT "C"
    `);
    expect(result.output).toEqual(["A", "C"]);
  });

  it("should support OPTIONAL default value and validator", async () => {
    const engine = new HomeScriptEngine({ queryParams: {} });
    const result = await engine.execute(`
      OPTIONAL $mode = "off" IF ($mode = "off" OR $mode = "on")
      PRINT $mode
    `);
    expect(result.output).toEqual(["off"]);
  });

  it("should reject OPTIONAL/REQUIRED when validator IF is false", async () => {
    const optionalEngine = new HomeScriptEngine({ queryParams: { mode: "invalid" } });
    await expect(
      optionalEngine.execute(`
        OPTIONAL $mode = "off" IF ($mode = "off" OR $mode = "on")
      `),
    ).rejects.toThrow("Validation failed for mode");

    const requiredEngine = new HomeScriptEngine({ queryParams: { limit: "3" } });
    await expect(
      requiredEngine.execute(`
        REQUIRED $limit IF ($limit > 10)
      `),
    ).rejects.toThrow("Validation failed for limit");
  });

  it("should stop execution with BREAK status and message", async () => {
    const engine = new HomeScriptEngine();
    await expect(
      engine.execute(`
        PRINT "before"
        BREAK 404 "device not found"
        PRINT "after"
      `),
    ).rejects.toThrow("device not found");
  });

  it("should throw for unknown GOTO label", async () => {
    const engine = new HomeScriptEngine();
    await expect(engine.execute("GOTO nowhere")).rejects.toThrow("Unknown label");
  });

  it("should throw for invalid syntaxes", async () => {
    const engine = new HomeScriptEngine();
    await expect(engine.execute("SET wrong-syntax")).rejects.toThrow(HomeScriptError);
    await expect(engine.execute("GET sensor.temp $x")).rejects.toThrow(HomeScriptError);
    await expect(engine.execute("CALL light.turn_on")).rejects.toThrow(HomeScriptError);
    await expect(engine.execute("PRINT")).rejects.toThrow(HomeScriptError);
  });

  it("should throw for missing END blocks", async () => {
    const engine = new HomeScriptEngine();
    await expect(engine.execute("IF true\nPRINT 1")).rejects.toThrow("Missing END_IF");
    await expect(engine.execute("WHILE true DO\nPRINT 1")).rejects.toThrow("Missing END_WHILE");
    await expect(engine.execute("FUNCTION x()\nPRINT 1")).rejects.toThrow("Missing END_FUNCTION");
  });

  it("should throw error on invalid syntax", async () => {
    const engine = new HomeScriptEngine();
    await expect(engine.execute('INVALID_KEYWORD')).rejects.toThrow(HomeScriptError);
  });
});
