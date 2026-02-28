import WebSocket from "ws";
import { HomeScriptEngine, HomeScriptOptions } from "../shared/homescript.js";
import { evaluateHomeScriptExpression } from "../shared/homescript/expression.js";
import { ScriptTriggerConfig, TriggerLevel, TriggerRule, normalizeScriptTriggerConfig } from "../shared/trigger-config.js";
import { getScriptByEndpoint, getScriptsWithTriggerConfigs } from "./db.js";
import { fetchFromHomeAssistant } from "./ha-client.js";

type StateChangedData = {
  entity_id: string;
  old_state?: { state?: string } | null;
  new_state?: { state?: string } | null;
};

const isEnabled = () => Boolean(process.env.HA_URL && process.env.HA_TOKEN);

const toWsUrl = (haUrl: string) => haUrl.replace(/^http/, "ws") + "/api/websocket";

const asNumber = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const crossedLevel = (oldValue: number, newValue: number, levels: TriggerLevel[]): TriggerLevel | null => {
  const sorted = [...levels].sort((a, b) => a.value - b.value);
  for (const level of sorted) {
    if (oldValue < level.value && newValue >= level.value) return level;
    if (oldValue > level.value && newValue <= level.value) return level;
  }
  return null;
};

const toRuleVarName = (name: string) => {
  const normalized = name.trim().replace(/[^a-zA-Z0-9_]/g, "_");
  if (!normalized) return "RULE";
  if (/^\d/.test(normalized)) return `RULE_${normalized}`;
  return normalized;
};

const normalizeRuleExpressionInput = (raw: string) => {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  const withoutIf = trimmed.replace(/^\s*IF\s+/i, "");
  const withoutEndIf = withoutIf.replace(/\s*END_IF\s*$/i, "");
  return withoutEndIf.trim();
};

const createEngineOptions = (): HomeScriptOptions => ({
    onCall: async (service, args) => {
      if (process.env.HA_URL && process.env.HA_TOKEN) {
        const [domain, serviceName] = service.split(".");
        if (!domain || !serviceName) throw new Error(`Invalid service format: ${service}`);

        let payload = {};
        if (args.length > 0) {
          if (typeof args[0] === "object") payload = args[0];
          else if (typeof args[0] === "string") payload = { entity_id: args[0] };
        }

        const res = await fetchFromHomeAssistant(`/api/services/${domain}/${serviceName}`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Home Assistant Error (${res.status}): ${errText}`);
        }
        return await res.json();
      }
      return { success: true, simulated: true };
    },
    onGet: async (entityId) => {
      if (process.env.HA_URL && process.env.HA_TOKEN) {
        const res = await fetchFromHomeAssistant(`/api/states/${entityId}`);
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Home Assistant Error (${res.status}): ${errText}`);
        }
        const state: any = await res.json();
        return state.state;
      }
      return "mock_state";
    },
    onSet: async (entityId, state) => {
      if (process.env.HA_URL && process.env.HA_TOKEN) {
        const res = await fetchFromHomeAssistant(`/api/states/${entityId}`, {
          method: "POST",
          body: JSON.stringify({ state: String(state) }),
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Home Assistant Error (${res.status}): ${errText}`);
        }
        const next: any = await res.json();
        return next.state;
      }
      return state;
    },
    importCallback: async (name: string) => {
      const importedScript = getScriptByEndpoint(name);
      if (!importedScript) throw new Error(`Script with endpoint '${name}' not found`);
      return importedScript.code as string;
    },
  });

const evaluateRule = (rule: TriggerRule, data: StateChangedData) => {
  if (rule.entityId && rule.entityId !== data.entity_id) return null;

  const oldState = data.old_state?.state;
  const newState = data.new_state?.state;
  if (newState === undefined) return null;

  if (rule.eventType === "any_change") {
    if (oldState === newState) return null;
    return { name: rule.name || "state_changed", value: newState };
  }

  if (rule.eventType === "toggle") {
    if (oldState === newState) return null;
    const expectedFrom = rule.toggleFrom === "custom" ? (rule.toggleFromCustom || "").trim() : rule.toggleFrom;
    const expectedTo = rule.toggleTo === "custom" ? (rule.toggleToCustom || "").trim() : rule.toggleTo;
    if (expectedFrom && expectedFrom !== "any" && oldState !== expectedFrom) return null;
    if (expectedTo && expectedTo !== "any" && newState !== expectedTo) return null;
    return {
      name: rule.name || (newState === "on" ? "toggled_on" : newState === "off" ? "toggled_off" : "toggled"),
      value: newState,
    };
  }

  if (rule.eventType === "sensor_levels") {
    const oldNum = asNumber(oldState);
    const newNum = asNumber(newState);
    if (oldNum === null || newNum === null) return null;
    if (!Array.isArray(rule.levels) || rule.levels.length === 0) return null;
    const level = crossedLevel(oldNum, newNum, rule.levels || []);
    if (level) return { name: level.name, value: level.value };
    // Secondary validation mode for non-crossing updates: above at least one level.
    const sorted = [...rule.levels].sort((a, b) => b.value - a.value);
    const above = sorted.find((l) => newNum >= l.value);
    if (!above) return null;
    if (oldNum === newNum) return null;
    return { name: above.name, value: newNum };
  }

  return null;
};

const evaluateTrigger = (config: ScriptTriggerConfig, data: StateChangedData) => {
  const rules = config.rules;
  if (!Array.isArray(rules) || rules.length === 0) return null;

  const matches = rules
    .map((rule) => ({ rule, match: evaluateRule(rule, data) }))
    .filter((entry) => Boolean(entry.match)) as Array<{ rule: TriggerRule; match: { name: string; value: any } }>;

  const ruleStates = rules.map((rule) => {
    const hit = matches.find((m) => m.rule.id === rule.id);
    return {
      id: rule.id,
      name: rule.name,
      varName: toRuleVarName(rule.name).toUpperCase(),
      entityId: rule.entityId,
      eventType: rule.eventType,
      matched: Boolean(hit),
      value: hit?.match.value,
    };
  });

  const varMap = ruleStates.reduce<Record<string, boolean>>((acc, rule) => {
    acc[rule.varName] = rule.matched;
    return acc;
  }, {});

  let isTriggered = false;
  let expressionError: string | null = null;
  const normalizedExpression = normalizeRuleExpressionInput(config.ruleExpression || "");
  if (normalizedExpression.length > 0) {
    try {
      isTriggered = Boolean(evaluateHomeScriptExpression(normalizedExpression, varMap));
    } catch (e: any) {
      expressionError = e?.message || "Invalid rule expression";
      isTriggered = false;
    }
  } else {
    isTriggered = matches.length > 0;
  }

  if (!isTriggered) return null;

  const primary = matches[0]?.match;

  return {
    name: primary?.name || "rules_matched",
    value: primary?.value ?? data.new_state?.state,
    expressionError,
    ruleVars: varMap,
    matchedRules: ruleStates,
  };
};

const handleStateChanged = async (data: StateChangedData) => {
  const scripts = getScriptsWithTriggerConfigs() as any[];
  for (const script of scripts) {
    let parsedTrigger: ScriptTriggerConfig;
    try {
      parsedTrigger = normalizeScriptTriggerConfig(script.trigger_config ? JSON.parse(script.trigger_config) : {});
    } catch {
      parsedTrigger = normalizeScriptTriggerConfig({});
    }

    const matched = evaluateTrigger(parsedTrigger, data);
    if (!matched) continue;

    const eventPayload = {
      type: "rule_group",
      logic: parsedTrigger.logic,
      expression: normalizeRuleExpressionInput(parsedTrigger.ruleExpression || "") || null,
      entity_id: data.entity_id,
      name: matched.name,
      value: matched.value,
      matches: matched.matchedRules,
      rule_vars: matched.ruleVars,
      expression_error: matched.expressionError,
      old: data.old_state?.state,
      current: data.new_state?.state,
      timestamp: new Date().toISOString(),
    };

    try {
      const runEngine = new HomeScriptEngine({
        ...createEngineOptions(),
        variables: { event: eventPayload },
      });
      await runEngine.execute(script.code);
      console.log(`[HA Event Engine] Triggered script '${script.endpoint}' via ${eventPayload.entity_id} (${eventPayload.name})`);
    } catch (e: any) {
      console.error(`[HA Event Engine] Script '${script.endpoint}' failed: ${e.message}`);
    }
  }
};

export const startHaEventEngine = () => {
  if (!isEnabled()) {
    console.log("[HA Event Engine] Disabled (HA_URL/HA_TOKEN not configured)");
    return;
  }

  const haUrl = process.env.HA_URL!;
  const token = process.env.HA_TOKEN!;

  let ws: WebSocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let nextId = 1;
  let subscribeId = -1;

  const scheduleReconnect = () => {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 5000);
  };

  const connect = () => {
    try {
      ws = new WebSocket(toWsUrl(haUrl));
    } catch (e: any) {
      console.error(`[HA Event Engine] WebSocket create failed: ${e.message}`);
      scheduleReconnect();
      return;
    }

    ws.on("open", () => {
      console.log("[HA Event Engine] Connected to Home Assistant websocket");
    });

    ws.on("message", async (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "auth_required") {
        ws?.send(JSON.stringify({ type: "auth", access_token: token }));
        return;
      }

      if (msg.type === "auth_ok") {
        subscribeId = ++nextId;
        ws?.send(JSON.stringify({ id: subscribeId, type: "subscribe_events", event_type: "state_changed" }));
        return;
      }

      if (msg.type === "result" && msg.id === subscribeId) {
        if (msg.success) console.log("[HA Event Engine] Subscribed to state_changed events");
        else console.error("[HA Event Engine] Failed to subscribe to state_changed events");
        return;
      }

      if (msg.type === "event" && msg.event?.event_type === "state_changed") {
        const data = msg.event?.data as StateChangedData;
        if (!data?.entity_id) return;
        await handleStateChanged(data);
      }
    });

    ws.on("close", () => {
      console.log("[HA Event Engine] Connection closed, scheduling reconnect");
      scheduleReconnect();
    });

    ws.on("error", (err) => {
      console.error("[HA Event Engine] WebSocket error", err);
    });
  };

  connect();
};
