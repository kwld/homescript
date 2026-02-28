import { useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  createDefaultTriggerRule,
  ScriptTriggerConfig,
  TriggerEventType,
  TriggerLevel,
  TriggerPreviewScale,
  TriggerRule,
} from "../shared/trigger-config";
import { HAEntity } from "../shared/ha-api";
import { parseHistoryApiResponse } from "../shared/history";
import { evaluateHomeScriptExpression } from "../shared/homescript/expression";
import { Button } from "./ui/Button";
import EntitySelectorPopup from "./EntitySelectorPopup";
import { Input } from "./ui/Input";

interface EventTriggerConfiguratorProps {
  value: ScriptTriggerConfig;
  onChange: (next: ScriptTriggerConfig) => void;
  entities: HAEntity[];
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const EDGE_EXPAND_THRESHOLD_PX = 8;
const DROP_REMOVE_THRESHOLD_PX = 40;
const EDGE_EXPAND_INTERVAL_MS = 85;
const EDGE_EXPAND_STEP_RATIO = 0.04;

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

const inferEventTypeFromEntity = (entity: HAEntity | null): TriggerEventType => {
  if (!entity) return "any_change";
  const entityId = entity.entity_id.toLowerCase();
  const state = String(entity.state || "").toLowerCase();
  const attrs = entity.attributes || {};
  const hasNumericState = Number.isFinite(Number(entity.state));
  const unit = String(attrs.unit_of_measurement || "").toLowerCase();
  const stateClass = String(attrs.state_class || "").toLowerCase();
  const deviceClass = String(attrs.device_class || "").toLowerCase();

  const likelyToggleDomain =
    entityId.startsWith("switch.") ||
    entityId.startsWith("light.") ||
    entityId.startsWith("input_boolean.") ||
    entityId.startsWith("binary_sensor.");
  const isToggleState = state === "on" || state === "off";
  if (likelyToggleDomain || isToggleState) return "toggle";

  const likelyMeasured =
    hasNumericState ||
    Boolean(unit) ||
    stateClass === "measurement" ||
    ["power", "energy", "temperature", "humidity", "illuminance", "current", "voltage"].includes(deviceClass);
  if (likelyMeasured) return "sensor_levels";

  return "any_change";
};

const generatePreviewData = (min: number, max: number) => {
  const points = 40;
  const amp = (max - min) * 0.2;
  const mid = (max + min) / 2;
  return Array.from({ length: points }).map((_, i) => ({
    x: i,
    value: mid + Math.sin(i / 4) * amp + Math.cos(i / 7) * amp * 0.5,
  }));
};

export default function EventTriggerConfigurator({ value, onChange, entities }: EventTriggerConfiguratorProps) {
  const [selectedRuleId, setSelectedRuleId] = useState<string>(value.rules[0]?.id || "");
  const [dragLevelId, setDragLevelId] = useState<string | null>(null);
  const [historyPoints, setHistoryPoints] = useState<Array<{ ts: string; value: number; state?: string }>>([]);
  const [historyStateOptions, setHistoryStateOptions] = useState<string[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [showEntityPicker, setShowEntityPicker] = useState(false);
  const [debugUseFakeData, setDebugUseFakeData] = useState(true);
  const [debugEntityId, setDebugEntityId] = useState("");
  const [debugOldState, setDebugOldState] = useState("off");
  const [debugNewState, setDebugNewState] = useState("on");
  const [debugResult, setDebugResult] = useState<{
    triggered: boolean;
    expression: string;
    ruleVars: Record<string, boolean>;
    details: string[];
  } | null>(null);
  const graphRef = useRef<HTMLDivElement | null>(null);
  const valueRef = useRef(value);
  const dragExpandLastTsRef = useRef(0);

  useEffect(() => {
    valueRef.current = value;
    if (!value.rules.some((r) => r.id === selectedRuleId)) {
      setSelectedRuleId(value.rules[0]?.id || "");
    }
  }, [selectedRuleId, value]);

  const selectedRule = useMemo(
    () => value.rules.find((rule) => rule.id === selectedRuleId) || value.rules[0] || null,
    [selectedRuleId, value.rules],
  );

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    const entityId = selectedRule?.entityId.trim() || "";
    const shouldLoad = selectedRule?.eventType === "sensor_levels" && entityId && token;

    if (!shouldLoad) {
      setHistoryPoints([]);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }

    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError(null);

    fetch(`/api/history?entityId=${encodeURIComponent(entityId)}&hours=24`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async (res) => {
        const contentType = res.headers.get("content-type");
        const text = await res.text();
        return parseHistoryApiResponse(res.status, contentType, text);
      })
      .then((data) => {
        setHistoryPoints(data.points);
      })
      .catch((err: any) => {
        if (err?.name === "AbortError") return;
        setHistoryPoints([]);
        setHistoryError(err?.message || "Failed to load state history");
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });

    return () => controller.abort();
  }, [selectedRule?.entityId, selectedRule?.eventType]);

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    const entityId = selectedRule?.entityId.trim() || "";
    if (!entityId || !token) {
      setHistoryStateOptions([]);
      return;
    }

    const controller = new AbortController();
    fetch(`/api/history?entityId=${encodeURIComponent(entityId)}&hours=168`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async (res) => {
        const text = await res.text();
        let data: any = null;
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
        if (!res.ok || !data || typeof data !== "object") {
          setHistoryStateOptions([]);
          return;
        }
        const states = Array.isArray(data.states) ? data.states.map((v: any) => String(v)) : [];
        setHistoryStateOptions(Array.from(new Set(states)));
      })
      .catch(() => {
        setHistoryStateOptions([]);
      });

    return () => controller.abort();
  }, [selectedRule?.entityId]);

  const data = useMemo(() => {
    if (historyPoints.length > 0) {
      return historyPoints.map((p, index) => ({
        x: index,
        value: p.value,
        ts: p.ts,
        state: p.state ?? String(p.value),
      }));
    }
    const min = selectedRule?.rangeMin ?? 0;
    const max = selectedRule?.rangeMax ?? 100;
    return generatePreviewData(min, max).map((p) => ({
      ...p,
      ts: "",
      state: String(p.value),
    }));
  }, [historyPoints, selectedRule?.rangeMax, selectedRule?.rangeMin]);

  const chartRange = useMemo(() => {
    const minBase = selectedRule?.rangeMin ?? 0;
    const maxBase = selectedRule?.rangeMax ?? 100;
    const allValues = data.map((point) => point.value);
    const levelValues = selectedRule?.levels.map((level) => level.value) || [];
    const min = Math.min(minBase, ...(allValues.length > 0 ? allValues : [minBase]), ...(levelValues.length > 0 ? levelValues : [minBase]));
    const max = Math.max(maxBase, ...(allValues.length > 0 ? allValues : [maxBase]), ...(levelValues.length > 0 ? levelValues : [maxBase]));
    if (max === min) return { min: min - 1, max: max + 1 };
    return { min, max };
  }, [data, selectedRule?.levels, selectedRule?.rangeMax, selectedRule?.rangeMin]);

  const canUseLogPreview = useMemo(() => {
    if (!selectedRule || selectedRule.previewScale !== "logarithmic") return false;
    if (chartRange.min <= 0 || chartRange.max <= 0) return false;
    return data.every((point) => point.value > 0) && selectedRule.levels.every((level) => level.value > 0);
  }, [chartRange.max, chartRange.min, data, selectedRule]);

  const commitConfig = (next: ScriptTriggerConfig) => {
    valueRef.current = next;
    onChange(next);
  };

  const updateRule = (ruleId: string, patch: Partial<TriggerRule>) => {
    const current = valueRef.current;
    commitConfig({
      ...current,
      rules: current.rules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)),
    });
  };

  const updateRuleEntity = (ruleId: string, entityId: string) => {
    const matchedEntity = entities.find((entity) => entity.entity_id === entityId) || null;
    const inferredType = inferEventTypeFromEntity(matchedEntity);
    updateRule(ruleId, { entityId, eventType: inferredType });
  };

  const addRule = () => {
    const current = valueRef.current;
    const nextRule = createDefaultTriggerRule(current.rules.length + 1);
    const next = { ...current, rules: [...current.rules, nextRule] };
    commitConfig(next);
    setSelectedRuleId(nextRule.id);
  };

  const removeRule = (ruleId: string) => {
    const current = valueRef.current;
    const nextRules = current.rules.filter((rule) => rule.id !== ruleId);
    commitConfig({ ...current, rules: nextRules });
    if (selectedRuleId === ruleId) {
      setSelectedRuleId(nextRules[0]?.id || "");
    }
  };

  const mapYToValue = (clientY: number, min: number, max: number, useLogScale: boolean) => {
    const el = graphRef.current;
    if (!el) return min;
    const rect = el.getBoundingClientRect();
    const ratio = clamp((clientY - rect.top) / rect.height, 0, 1);
    if (useLogScale && min > 0 && max > 0 && max > min) {
      const logMin = Math.log(min);
      const logMax = Math.log(max);
      return Number(Math.exp(logMax - ratio * (logMax - logMin)).toFixed(2));
    }
    return Number((max - ratio * (max - min)).toFixed(2));
  };

  const yToValue = (clientY: number) => mapYToValue(clientY, chartRange.min, chartRange.max, canUseLogPreview);

  const getPercentForLevel = (levelValue: number) => {
    if (canUseLogPreview && chartRange.min > 0 && chartRange.max > chartRange.min && levelValue > 0) {
      const logMin = Math.log(chartRange.min);
      const logMax = Math.log(chartRange.max);
      const logLevel = Math.log(levelValue);
      const ratio = (logLevel - logMin) / (logMax - logMin);
      return clamp(100 - ratio * 100, 0, 100);
    }
    if (chartRange.max === chartRange.min) return 50;
    const ratio = (levelValue - chartRange.min) / (chartRange.max - chartRange.min);
    return clamp(100 - ratio * 100, 0, 100);
  };

  const normalizeRuleRangeToValues = (ruleId: string) => {
    const current = valueRef.current;
    const rule = current.rules.find((r) => r.id === ruleId);
    if (!rule) return;
    const seriesValues = data.map((point) => point.value);
    const levelValues = rule.levels.map((level) => level.value);
    const allValues = [...seriesValues, ...levelValues];
    if (allValues.length === 0) return;
    let nextMin = Math.min(...allValues);
    let nextMax = Math.max(...allValues);
    if (nextMin === nextMax) {
      nextMin -= 1;
      nextMax += 1;
    }
    updateRule(ruleId, { rangeMin: Number(nextMin.toFixed(2)), rangeMax: Number(nextMax.toFixed(2)) });
  };

  const setLevel = (levelId: string, patch: Partial<TriggerLevel>) => {
    if (!selectedRule) return;
    updateRule(selectedRule.id, {
      levels: selectedRule.levels.map((level) => (level.id === levelId ? { ...level, ...patch } : level)),
    });
  };

  const addLevel = () => {
    if (!selectedRule) return;
    const nextValue = clamp((chartRange.min + chartRange.max) / 2, chartRange.min, chartRange.max);
    updateRule(selectedRule.id, {
      levels: [
        ...selectedRule.levels,
        {
          id: `level-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: `Level ${selectedRule.levels.length + 1}`,
          value: nextValue,
        },
      ],
    });
  };

  const removeLevel = (levelId: string) => {
    if (!selectedRule) return;
    updateRule(selectedRule.id, { levels: selectedRule.levels.filter((l) => l.id !== levelId) });
  };

  const startDrag = (levelId: string) => {
    if (!selectedRule) return;
    setDragLevelId(levelId);
    dragExpandLastTsRef.current = 0;

    const onMove = (e: MouseEvent) => {
      const el = graphRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const current = valueRef.current;
      const rule = current.rules.find((r) => r.id === selectedRule.id);
      if (!rule) return;

      const span = Math.max(1, rule.rangeMax - rule.rangeMin);
      const edgeStep = Math.max(0.25, Number((span * EDGE_EXPAND_STEP_RATIO).toFixed(2)));
      const now = Date.now();

      if (e.clientY >= rect.bottom + DROP_REMOVE_THRESHOLD_PX) {
        removeLevel(levelId);
        return;
      }

      if (e.clientY <= rect.top + EDGE_EXPAND_THRESHOLD_PX) {
        if (now - dragExpandLastTsRef.current < EDGE_EXPAND_INTERVAL_MS) return;
        dragExpandLastTsRef.current = now;
        const nextMax = Number((rule.rangeMax + edgeStep).toFixed(2));
        const nextValue = mapYToValue(e.clientY, rule.rangeMin, nextMax, rule.previewScale === "logarithmic");
        updateRule(rule.id, {
          rangeMax: nextMax,
          levels: rule.levels.map((level) => (level.id === levelId ? { ...level, value: nextValue } : level)),
        });
        return;
      }

      if (e.clientY >= rect.bottom - EDGE_EXPAND_THRESHOLD_PX) {
        if (now - dragExpandLastTsRef.current < EDGE_EXPAND_INTERVAL_MS) return;
        dragExpandLastTsRef.current = now;
        const nextMin = Number((rule.rangeMin - edgeStep).toFixed(2));
        const nextValue = mapYToValue(e.clientY, nextMin, rule.rangeMax, rule.previewScale === "logarithmic");
        updateRule(rule.id, {
          rangeMin: nextMin,
          levels: rule.levels.map((level) => (level.id === levelId ? { ...level, value: nextValue } : level)),
        });
        return;
      }

      setLevel(levelId, { value: yToValue(e.clientY) });
    };

    const onUp = () => {
      setDragLevelId(null);
      normalizeRuleRangeToValues(selectedRule.id);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const evaluateRuleMatch = (rule: TriggerRule) => {
    const entityMatches = !rule.entityId || rule.entityId === debugEntityId;
    if (!entityMatches) return { ok: false, reason: "entity mismatch" };

    if (rule.eventType === "toggle") {
      const changed = debugOldState !== debugNewState;
      if (!changed) return { ok: false, reason: "state unchanged" };
      const expectedFrom = rule.toggleFrom === "custom" ? (rule.toggleFromCustom || "").trim() : rule.toggleFrom;
      const expectedTo = rule.toggleTo === "custom" ? (rule.toggleToCustom || "").trim() : rule.toggleTo;
      if (expectedFrom && expectedFrom !== "any" && debugOldState !== expectedFrom) return { ok: false, reason: "from-state mismatch" };
      if (expectedTo && expectedTo !== "any" && debugNewState !== expectedTo) return { ok: false, reason: "to-state mismatch" };
      return { ok: true, reason: "change transition matched" };
    }

    if (rule.eventType === "any_change") {
      return debugOldState !== debugNewState ? { ok: true, reason: "state changed" } : { ok: false, reason: "state unchanged" };
    }

    if (rule.eventType === "sensor_levels") {
      if (!rule.levels || rule.levels.length === 0) return { ok: false, reason: "no levels defined" };
      const oldNum = Number(debugOldState);
      const newNum = Number(debugNewState);
      if (!Number.isFinite(oldNum) || !Number.isFinite(newNum)) return { ok: false, reason: "non-numeric sensor state" };
      const crossed = rule.levels.some((level) => (oldNum < level.value && newNum >= level.value) || (oldNum > level.value && newNum <= level.value));
      const above = rule.levels.some((level) => newNum >= level.value);
      if (crossed) return { ok: true, reason: "level crossed" };
      if (newNum !== oldNum && above) return { ok: true, reason: "above level + changed" };
      return { ok: false, reason: "below levels or unchanged" };
    }

    return { ok: false, reason: "unsupported rule type" };
  };

  const runRuleDebugger = () => {
    const vars: Record<string, boolean> = {};
    const details: string[] = [];

    value.rules.forEach((rule) => {
      const result = evaluateRuleMatch(rule);
      const varName = toRuleVarName(rule.name).toUpperCase();
      vars[varName] = result.ok;
      details.push(`${varName}: ${result.ok ? "true" : "false"} (${result.reason})`);
    });

    const expr = normalizeRuleExpressionInput(value.ruleExpression || "");
    let triggered = false;
    if (expr) {
      triggered = Boolean(evaluateHomeScriptExpression(expr, vars));
    } else {
      const vals = Object.values(vars);
      triggered = vals.some(Boolean);
    }

    setDebugResult({
      triggered,
      expression: expr || `(${value.logic}) fallback`,
      ruleVars: vars,
      details,
    });
  };

  const expressionValidationError = useMemo(() => {
    const expr = normalizeRuleExpressionInput(value.ruleExpression || "");
    if (!expr) return null;
    try {
      const probeVars = value.rules.reduce<Record<string, boolean>>((acc, rule) => {
        acc[toRuleVarName(rule.name)] = false;
        return acc;
      }, {});
      evaluateHomeScriptExpression(expr, probeVars);
      return null;
    } catch (e: any) {
      return e?.message || "Expression is invalid.";
    }
  }, [value.ruleExpression, value.rules]);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-4">
      <div className="space-y-2">
        <div className="text-sm font-medium text-zinc-300">Event Expression (HomeScript-style)</div>
        <div className="text-xs text-zinc-400">
          Use variables by event name: {value.rules.map((rule) => `$${toRuleVarName(rule.name)}`).join(", ") || "(add events)"}.
          Operators: <code>AND</code>, <code>OR</code>, <code>NOT</code>, parentheses.
          Type only condition body; <code>IF</code> / <code>END_IF</code> are added automatically.
        </div>
        <div className="border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-3 pt-2 text-xs font-mono text-emerald-300 bg-zinc-900 border-b border-zinc-800">IF</div>
          <Editor
            height="96px"
            defaultLanguage="homescript"
            theme="homescript-dark"
            value={normalizeRuleExpressionInput(value.ruleExpression || "")}
            onChange={(next) => commitConfig({ ...value, ruleExpression: normalizeRuleExpressionInput(next || "") })}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: "off",
              wordWrap: "on",
              scrollBeyondLastLine: false,
              padding: { top: 8, bottom: 8 },
            }}
          />
          <div className="px-3 py-2 text-xs font-mono text-emerald-300 bg-zinc-900 border-t border-zinc-800">END_IF</div>
        </div>
        {expressionValidationError && <div className="text-xs text-amber-300">Validation: {expressionValidationError}</div>}
      </div>

      <div className="space-y-2 border border-zinc-800 rounded-2xl p-3 bg-zinc-950/40">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm font-medium text-zinc-300">Event Debugger</div>
          <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={debugUseFakeData}
              onChange={(e) => setDebugUseFakeData(e.target.checked)}
              className="accent-emerald-500"
            />
            Use fake event data
          </label>
          <Button size="sm" onClick={runRuleDebugger} disabled={!debugUseFakeData}>Evaluate</Button>
        </div>
        {debugUseFakeData && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Input label="Entity" value={debugEntityId} onChange={(e) => setDebugEntityId(e.target.value)} placeholder="sensor.example" />
            <Input label="Old State" value={debugOldState} onChange={(e) => setDebugOldState(e.target.value)} placeholder="off / 12.3" />
            <Input label="New State" value={debugNewState} onChange={(e) => setDebugNewState(e.target.value)} placeholder="on / 45.6" />
          </div>
        )}
        {!debugUseFakeData && (
          <div className="text-xs text-zinc-400">Live-event debugging is evaluated on backend event stream. Enable fake data to test locally.</div>
        )}
        {debugResult && (
          <div className="text-xs space-y-1">
            <div className={debugResult.triggered ? "text-emerald-300" : "text-zinc-300"}>
              Result: {debugResult.triggered ? "TRIGGERED" : "NOT TRIGGERED"} | Expr: {debugResult.expression}
            </div>
            {debugResult.details.map((line, i) => (
              <div key={`${line}-${i}`} className="text-zinc-400 font-mono">{line}</div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-zinc-300">Events</h4>
          <Button size="sm" onClick={addRule}>New Event</Button>
        </div>
        {value.rules.map((rule, index) => (
          <div
            key={rule.id}
            className={`border rounded-xl px-3 py-2 cursor-pointer ${
              selectedRule?.id === rule.id ? "border-emerald-500 bg-zinc-800/50" : "border-zinc-700 bg-zinc-900/40"
            }`}
            onClick={() => setSelectedRuleId(rule.id)}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-zinc-200">{rule.name || `Event ${index + 1}`}</span>
              <span className="text-xs font-mono text-zinc-400">${toRuleVarName(rule.name)}</span>
              <span className="text-xs text-zinc-400">{rule.eventType}</span>
              <span className="text-xs text-zinc-500 truncate">{rule.entityId || "any entity"}</span>
              <div className="ml-auto">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeRule(rule.id);
                  }}
                >
                  Remove
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {selectedRule && (
        <div className="space-y-4 border border-zinc-800 rounded-2xl p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input
              label="Event Name"
              value={selectedRule.name}
              onChange={(e) => updateRule(selectedRule.id, { name: e.target.value })}
              placeholder="Event label"
            />
            <Input
              label="Entity"
              value={selectedRule.entityId}
              onChange={(e) => updateRuleEntity(selectedRule.id, e.target.value)}
              placeholder="sensor.temperature"
            />
            <div className="flex items-end">
              <Button size="sm" variant="secondary" onClick={() => setShowEntityPicker(true)}>
                Pick Entity
              </Button>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-300">Event Type</label>
              <select
                value={selectedRule.eventType}
                onChange={(e) => updateRule(selectedRule.id, { eventType: e.target.value as TriggerEventType })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              >
                <option value="toggle">Change (from {"->"} to)</option>
                <option value="any_change">Any state change</option>
                <option value="sensor_levels">Sensor levels (graph)</option>
              </select>
            </div>
            {selectedRule.eventType === "toggle" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-zinc-300">From</label>
                  <select
                    value={selectedRule.toggleFrom}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val.startsWith("history:")) {
                        updateRule(selectedRule.id, { toggleFrom: "custom", toggleFromCustom: val.slice("history:".length) });
                        return;
                      }
                      updateRule(selectedRule.id, { toggleFrom: val as "any" | "on" | "off" | "unavailable" | "custom" });
                    }}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  >
                    <option value="any">Any</option>
                    <option value="off">off</option>
                    <option value="on">on</option>
                    <option value="unavailable">unavailable</option>
                    {historyStateOptions
                      .filter((state) => !["on", "off", "unavailable"].includes(state))
                      .map((state) => (
                        <option key={`from-${state}`} value={`history:${state}`} className="text-lime-300">
                          {state} (history)
                        </option>
                      ))}
                    <option value="custom">custom...</option>
                  </select>
                  {selectedRule.toggleFrom === "custom" && (
                    <Input
                      label="Custom From"
                      value={selectedRule.toggleFromCustom || ""}
                      onChange={(e) => updateRule(selectedRule.id, { toggleFromCustom: e.target.value })}
                      placeholder="enter exact state"
                    />
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-zinc-300">To</label>
                  <select
                    value={selectedRule.toggleTo}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val.startsWith("history:")) {
                        updateRule(selectedRule.id, { toggleTo: "custom", toggleToCustom: val.slice("history:".length) });
                        return;
                      }
                      updateRule(selectedRule.id, { toggleTo: val as "any" | "on" | "off" | "unavailable" | "custom" });
                    }}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  >
                    <option value="any">Any</option>
                    <option value="on">on</option>
                    <option value="off">off</option>
                    <option value="unavailable">unavailable</option>
                    {historyStateOptions
                      .filter((state) => !["on", "off", "unavailable"].includes(state))
                      .map((state) => (
                        <option key={`to-${state}`} value={`history:${state}`} className="text-lime-300">
                          {state} (history)
                        </option>
                      ))}
                    <option value="custom">custom...</option>
                  </select>
                  {selectedRule.toggleTo === "custom" && (
                    <Input
                      label="Custom To"
                      value={selectedRule.toggleToCustom || ""}
                      onChange={(e) => updateRule(selectedRule.id, { toggleToCustom: e.target.value })}
                      placeholder="enter exact state"
                    />
                  )}
                </div>
              </>
            )}
            {selectedRule.eventType === "sensor_levels" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-zinc-300">Preview Scale</label>
                  <select
                    value={selectedRule.previewScale}
                    onChange={(e) => updateRule(selectedRule.id, { previewScale: e.target.value as TriggerPreviewScale })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  >
                    <option value="linear">Linear</option>
                    <option value="logarithmic">Logarithmic</option>
                  </select>
                </div>
                <Input
                  label="Range Min"
                  type="number"
                  value={String(selectedRule.rangeMin)}
                  onChange={(e) => updateRule(selectedRule.id, { rangeMin: Number(e.target.value) })}
                />
                <Input
                  label="Range Max"
                  type="number"
                  value={String(selectedRule.rangeMax)}
                  onChange={(e) => updateRule(selectedRule.id, { rangeMax: Number(e.target.value) })}
                />
              </>
            )}
          </div>

          <div className="text-xs text-zinc-400">Injected vars: <code>$event.name</code> and <code>$event.value</code></div>

          {selectedRule.eventType === "sensor_levels" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-zinc-300">Trigger Levels (drag lines on graph)</h4>
                <Button size="sm" onClick={addLevel}>Add Level</Button>
              </div>
              <div className="text-xs text-zinc-400">
                {historyLoading && <span>Loading state history from Home Assistant...</span>}
                {!historyLoading && historyError && <span className="text-red-400">History unavailable: {historyError}</span>}
                {!historyLoading && !historyError && historyPoints.length > 0 && (
                  <span>Showing {historyPoints.length} historical points from Home Assistant.</span>
                )}
                {!historyLoading && !historyError && historyPoints.length === 0 && (
                  <span>No numeric history points returned. Showing preview signal.</span>
                )}
                {!historyLoading && !historyError && selectedRule.previewScale === "logarithmic" && !canUseLogPreview && (
                  <span className="text-amber-300">Log preview requires all values to be greater than 0. Falling back to linear.</span>
                )}
                {selectedRule.levels.length === 0 && (
                  <span className="text-amber-300">Validation: sensor-level event requires at least one level.</span>
                )}
              </div>
              <div ref={graphRef} className="relative w-full h-64 bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="x" tick={false} stroke="#3f3f46" />
                    <YAxis
                      domain={[Math.max(chartRange.min, canUseLogPreview ? 0.0001 : chartRange.min), chartRange.max]}
                      scale={canUseLogPreview ? "log" : "linear"}
                      stroke="#3f3f46"
                      tick={{ fill: "#a1a1aa", fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(v: any) => [String(v), "value"]}
                      labelFormatter={(label, payload: any) => {
                        const point = payload?.[0]?.payload;
                        return point?.ts ? new Date(point.ts).toLocaleString() : `Point ${label}`;
                      }}
                      contentStyle={{ backgroundColor: "#09090b", border: "1px solid #3f3f46", color: "#e4e4e7" }}
                      itemStyle={{ color: "#e4e4e7" }}
                      labelStyle={{ color: "#a1a1aa" }}
                    />
                    <Line type="monotone" dataKey="value" stroke="#10b981" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>

                {selectedRule.levels.map((level) => {
                  const top = `${getPercentForLevel(level.value)}%`;
                  return (
                    <div key={level.id} className="absolute left-0 right-0" style={{ top }}>
                      <div className="relative h-0 border-t border-dashed border-amber-400/80">
                        <button
                          type="button"
                          onMouseDown={() => startDrag(level.id)}
                          className={`absolute right-2 -top-3 px-2 py-1 text-[11px] rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-200 cursor-ns-resize ${dragLevelId === level.id ? "ring-1 ring-amber-300" : ""}`}
                        >
                          {level.name}: {level.value}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2">
                {selectedRule.levels.map((level) => (
                  <div key={level.id} className="grid grid-cols-1 md:grid-cols-[1fr_160px_auto] gap-2 items-end">
                    <Input
                      label="Level Name"
                      value={level.name}
                      onChange={(e) => setLevel(level.id, { name: e.target.value })}
                    />
                    <Input
                      label="Value"
                      type="number"
                      value={String(level.value)}
                      onChange={(e) => setLevel(level.id, { value: clamp(Number(e.target.value), chartRange.min, chartRange.max) })}
                    />
                    <Button variant="danger" size="sm" onClick={() => removeLevel(level.id)}>Remove</Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <EntitySelectorPopup
        isOpen={showEntityPicker}
        onClose={() => setShowEntityPicker(false)}
        entities={entities}
        value={selectedRule?.entityId || ""}
        onSelect={(entityId) => {
          if (!selectedRule) return;
          updateRuleEntity(selectedRule.id, entityId);
        }}
      />
    </div>
  );
}
