export type TriggerEventType = "any_change" | "toggle" | "sensor_levels";
export type TriggerPreviewScale = "linear" | "logarithmic";
export type TriggerRuleLogic = "AND" | "OR";
export type TriggerToggleState = "any" | "on" | "off" | "unavailable" | "custom";

export interface TriggerLevel {
  id: string;
  name: string;
  value: number;
}

export interface TriggerRule {
  id: string;
  name: string;
  entityId: string;
  eventType: TriggerEventType;
  toggleFrom: TriggerToggleState;
  toggleTo: TriggerToggleState;
  toggleFromCustom: string;
  toggleToCustom: string;
  previewScale: TriggerPreviewScale;
  levels: TriggerLevel[];
  rangeMin: number;
  rangeMax: number;
}

export interface ScriptTriggerConfig {
  logic: TriggerRuleLogic;
  ruleExpression: string;
  rules: TriggerRule[];
}

const createRuleId = () => `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const createDefaultTriggerRule = (index = 1): TriggerRule => ({
  id: createRuleId(),
  name: `Event ${index}`,
  entityId: "",
  eventType: "toggle",
  toggleFrom: "any",
  toggleTo: "any",
  toggleFromCustom: "",
  toggleToCustom: "",
  previewScale: "linear",
  levels: [
    { id: "level-1", name: "Level 1", value: 25 },
    { id: "level-2", name: "Level 2", value: 50 },
    { id: "level-3", name: "Level 3", value: 75 },
  ],
  rangeMin: 0,
  rangeMax: 100,
});

export const defaultTriggerConfig: ScriptTriggerConfig = {
  logic: "OR",
  ruleExpression: "",
  rules: [createDefaultTriggerRule(1)],
};

const normalizeRule = (raw: any, index: number): TriggerRule => ({
  id: typeof raw?.id === "string" && raw.id ? raw.id : createRuleId(),
  name: typeof raw?.name === "string" && raw.name.trim() ? raw.name : `Event ${index + 1}`,
  entityId: typeof raw?.entityId === "string" ? raw.entityId : "",
  eventType: raw?.eventType === "any_change" || raw?.eventType === "toggle" || raw?.eventType === "sensor_levels"
    ? raw.eventType
    : "toggle",
  toggleFrom:
    raw?.toggleFrom === "on" || raw?.toggleFrom === "off" || raw?.toggleFrom === "unavailable" || raw?.toggleFrom === "any" || raw?.toggleFrom === "custom"
      ? raw.toggleFrom
      : "any",
  toggleTo:
    raw?.toggleTo === "on" || raw?.toggleTo === "off" || raw?.toggleTo === "unavailable" || raw?.toggleTo === "any" || raw?.toggleTo === "custom"
      ? raw.toggleTo
      : "any",
  toggleFromCustom: typeof raw?.toggleFromCustom === "string" ? raw.toggleFromCustom : "",
  toggleToCustom: typeof raw?.toggleToCustom === "string" ? raw.toggleToCustom : "",
  previewScale: raw?.previewScale === "logarithmic" || raw?.previewScale === "linear" ? raw.previewScale : "linear",
  levels: Array.isArray(raw?.levels)
    ? raw.levels
        .filter((l: any) => l && typeof l === "object")
        .map((l: any, levelIndex: number) => ({
          id: String(l.id || `level-${levelIndex + 1}`),
          name: String(l.name || `Level ${levelIndex + 1}`),
          value: Number(l.value ?? 0),
        }))
        .filter((l: TriggerLevel) => Number.isFinite(l.value))
    : [
        { id: "level-1", name: "Level 1", value: 25 },
        { id: "level-2", name: "Level 2", value: 50 },
        { id: "level-3", name: "Level 3", value: 75 },
      ],
  rangeMin: Number.isFinite(Number(raw?.rangeMin)) ? Number(raw.rangeMin) : 0,
  rangeMax: Number.isFinite(Number(raw?.rangeMax)) ? Number(raw.rangeMax) : 100,
});

export const normalizeScriptTriggerConfig = (raw: unknown): ScriptTriggerConfig => {
  if (!raw || typeof raw !== "object") {
    return {
      logic: defaultTriggerConfig.logic,
      ruleExpression: defaultTriggerConfig.ruleExpression,
      rules: defaultTriggerConfig.rules.map((r, i) => normalizeRule(r, i)),
    };
  }

  const candidate = raw as any;
  const logic: TriggerRuleLogic = candidate.logic === "AND" ? "AND" : "OR";
  const ruleExpression = typeof candidate.ruleExpression === "string" ? candidate.ruleExpression : "";

  if (Array.isArray(candidate.rules)) {
    const rules = candidate.rules.map((r: any, i: number) => normalizeRule(r, i));
    return {
      logic,
      ruleExpression,
      rules,
    };
  }

  // Legacy single-rule config migration.
  if ("entityId" in candidate || "eventType" in candidate || "levels" in candidate) {
    const wasEnabled = candidate.enabled !== false;
    const migrated = normalizeRule(
      {
        ...candidate,
        name: typeof candidate.name === "string" ? candidate.name : "Event 1",
      },
      0,
    );
    return {
      logic: "OR",
      ruleExpression: "",
      rules: wasEnabled ? [migrated] : [],
    };
  }

  return {
    logic,
    ruleExpression,
    rules: [],
  };
};
