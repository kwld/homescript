import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Editor, { useMonaco } from "@monaco-editor/react";
import { Save, Play, ArrowLeft, Laptop, Bug, Pause, Square, Webhook, AlertCircle, Copy, Check, WandSparkles } from "lucide-react";
import { HomeScriptEngine, HomeScriptError } from "../shared/homescript";
import { validateHomeScript } from "../shared/homescript/validation";
import { HOME_SCRIPT_COMMON_LLM_REFERENCE } from "../shared/homescript/common-lib";
import { createCommonLibMonacoSuggestionFactory } from "../shared/homescript/monaco-completion-factory";
import { BrowserHAConnection } from "../client/ha-connection";
import { HAEntity, HAServices } from "../shared/ha-api";
import { BackendRunMeta, ExecutionEvent, ExecutionReport, HAStateEvent } from "../shared/execution-report";
import { ScriptTriggerConfig, defaultTriggerConfig, normalizeScriptTriggerConfig } from "../shared/trigger-config";
import CommandPalette from "../components/CommandPalette";
import ExecutionConsole from "../components/ExecutionConsole";
import EventTriggerConfigurator from "../components/EventTriggerConfigurator";
import FloatingVariablesPanel from "../components/FloatingVariablesPanel";
import { Button } from "../components/ui/Button";

type DebugDataMode = "auto" | "manual" | "preset" | "randomized";
type PromptMode = "CREATE" | "UPDATE" | "OPTIMIZE" | "API";

const DEBUG_PRESETS: Record<string, Record<string, any>> = {
  climate: { temperature: 24, humidity: 48, illuminance: 350, motion: false },
  night_mode: { temperature: 20, humidity: 55, illuminance: 5, motion: true },
  energy_peak: { power: 3400, voltage: 232, current: 14.7, grid_price: 1.12 },
};

const EVENTS_HEADER = "@events {";
const EVENT_EXPRESSION_HEADER = "@event_expression {";

type MetaBlocks = {
  hasMeta: boolean;
  body: string;
  eventsRaw: string;
  eventExpressionRaw: string;
};

type MetaParseResult = {
  eventStart: number;
  eventEnd: number;
  exprStart: number;
  exprEnd: number;
  bodyStart: number;
  eventsRaw: string;
  eventExpressionRaw: string;
};

const findMatchingBraceLine = (lines: string[], startLine: number): number => {
  let depth = 1;
  let inString = false;
  let escaped = false;
  for (let i = startLine + 1; i < lines.length; i += 1) {
    const line = lines[i] || "";
    for (let c = 0; c < line.length; c += 1) {
      const ch = line[c];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") depth += 1;
      if (ch === "}") depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
};

const findClosingLineByToken = (lines: string[], startLine: number, token = "}") => {
  for (let i = startLine + 1; i < lines.length; i += 1) {
    if ((lines[i] || "").trim() === token) return i;
  }
  return -1;
};

const parseMetaFromTop = (source: string): MetaParseResult | null => {
  const lines = String(source || "").split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i += 1;
  if ((lines[i] || "").trim() !== EVENTS_HEADER) return null;
  const eventStart = i;
  const eventEnd =
    findMatchingBraceLine(lines, eventStart) >= 0
      ? findMatchingBraceLine(lines, eventStart)
      : findClosingLineByToken(lines, eventStart, "}");
  if (eventEnd < 0) return null;

  i = eventEnd + 1;
  while (i < lines.length && lines[i].trim() === "") i += 1;
  if ((lines[i] || "").trim() !== EVENT_EXPRESSION_HEADER) return null;
  const exprStart = i;
  // Keep this tolerant while user is typing expression text (possibly with unclosed quotes).
  const exprEnd = findClosingLineByToken(lines, exprStart, "}");
  if (exprEnd < 0) return null;

  i = exprEnd + 1;
  while (i < lines.length && lines[i].trim() === "") i += 1;
  return {
    eventStart,
    eventEnd,
    exprStart,
    exprEnd,
    bodyStart: i,
    eventsRaw: lines.slice(eventStart + 1, eventEnd).join("\n"),
    eventExpressionRaw: lines.slice(exprStart + 1, exprEnd).join("\n"),
  };
};

const stripOneMetaPairFromTop = (source: string): { removed: boolean; rest: string } => {
  const parsed = parseMetaFromTop(source);
  if (!parsed) return { removed: false, rest: source };
  const lines = String(source || "").split("\n");
  return { removed: true, rest: lines.slice(parsed.bodyStart).join("\n") };
};

const stripAllMetaPairsFromTop = (source: string) => {
  let rest = String(source || "");
  while (true) {
    const pass = stripOneMetaPairFromTop(rest);
    if (!pass.removed) return rest;
    rest = pass.rest;
  }
};

const splitMetaBlocks = (source: string): MetaBlocks => {
  const result: MetaBlocks = { hasMeta: false, body: source, eventsRaw: "", eventExpressionRaw: "" };
  const parsed = parseMetaFromTop(source);
  if (!parsed) return result;
  const lines = String(source || "").split("\n");
  const body = lines.slice(parsed.bodyStart).join("\n");
  return {
    hasMeta: true,
    body,
    eventsRaw: parsed.eventsRaw,
    eventExpressionRaw: parsed.eventExpressionRaw,
  };
};

const buildEventsBlockBody = (triggerConfig: ScriptTriggerConfig) => {
  const payload: Record<string, any> = { ...triggerConfig };
  delete payload.ruleExpression;
  const json = JSON.stringify(payload, null, 2);
  const rows = json.split("\n");
  if (rows.length <= 2) return '  "rules": []';
  return rows.slice(1, -1).join("\n");
};

const composeCodeWithMeta = (body: string, triggerConfig: ScriptTriggerConfig) => {
  const cleanBody = stripAllMetaPairsFromTop(splitMetaBlocks(body).body);
  const eventsBody = buildEventsBlockBody(triggerConfig);
  const expression = triggerConfig.ruleExpression || "";
  return `${EVENTS_HEADER}\n${eventsBody}\n}\n${EVENT_EXPRESSION_HEADER}\n${expression}\n}\n\n${cleanBody}`;
};

const tryParseTriggerConfigFromBlocks = (
  source: string,
  fallback: ScriptTriggerConfig,
): ScriptTriggerConfig | null => {
  const split = splitMetaBlocks(source);
  if (!split.hasMeta) return null;
  try {
    const parsedObject = JSON.parse(`{\n${split.eventsRaw}\n}`) as Record<string, any>;
    const merged = normalizeScriptTriggerConfig({
      ...fallback,
      ...parsedObject,
      ruleExpression: split.eventExpressionRaw || "",
    });
    return merged;
  } catch {
    return null;
  }
};

const sanitizeCodeForExecution = (source: string) => {
  const parsed = parseMetaFromTop(source);
  if (!parsed) return source;
  const lines = String(source || "").split("\n");

  const commentAt = (idx: number) => {
    const raw = lines[idx] ?? "";
    lines[idx] = raw.trim().length === 0 ? "#" : `# ${raw}`;
  };

  for (let i = parsed.eventStart; i <= parsed.eventEnd; i += 1) commentAt(i);
  for (let i = parsed.exprStart; i <= parsed.exprEnd; i += 1) commentAt(i);
  return lines.join("\n");
};

const extractEntityIdsFromCode = (script: string, triggerConfig: ScriptTriggerConfig): string[] => {
  const entities = new Set<string>();
  const add = (value: string) => {
    const v = value.trim();
    if (v && /^[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+$/.test(v)) entities.add(v);
  };

  const getRegex = /GET\s+([a-zA-Z0-9_.]+)\s+INTO\s+\$[a-zA-Z0-9_]+/g;
  const setRegex = /SET\s+([a-zA-Z0-9_.]+)\s*=/g;
  const callStringArgRegex = /CALL\s+[a-zA-Z0-9_.]+\(\s*"([a-zA-Z0-9_.]+)"/g;
  const callEntityPayloadRegex = /entity_id"\s*:\s*"([a-zA-Z0-9_.]+)"/g;

  let m: RegExpExecArray | null = null;
  while ((m = getRegex.exec(script)) !== null) add(m[1]);
  while ((m = setRegex.exec(script)) !== null) add(m[1]);
  while ((m = callStringArgRegex.exec(script)) !== null) add(m[1]);
  while ((m = callEntityPayloadRegex.exec(script)) !== null) add(m[1]);

  (triggerConfig.rules || []).forEach((r) => add(r.entityId || ""));
  return Array.from(entities).sort();
};

const inferDefaultParamValue = (name: string): any => {
  const lower = name.toLowerCase();
  if (lower.includes("temp") || lower.includes("humidity") || lower.includes("pressure") || lower.includes("power") || lower.includes("voltage") || lower.includes("current") || lower.includes("illuminance") || lower.includes("level") || lower.includes("count")) return 25;
  if (lower.startsWith("is_") || lower.startsWith("has_") || lower.includes("enabled") || lower.includes("motion") || lower.includes("occupied")) return false;
  if (lower.includes("time")) return "12:00";
  if (lower.includes("date")) return "2026-02-28";
  return "value";
};

const buildAutoParamsFromCode = (script: string): Record<string, any> => {
  const vars = new Set<string>();
  const setAssigned = new Set<string>();
  const getAssigned = new Set<string>();

  const varRegex = /\$([a-zA-Z0-9_]+)/g;
  const setVarRegex = /SET\s+\$([a-zA-Z0-9_]+)\s*=/g;
  const getIntoRegex = /GET\s+[a-zA-Z0-9_.]+\s+INTO\s+\$([a-zA-Z0-9_]+)/g;

  let m: RegExpExecArray | null = null;
  while ((m = varRegex.exec(script)) !== null) vars.add(m[1]);
  while ((m = setVarRegex.exec(script)) !== null) setAssigned.add(m[1]);
  while ((m = getIntoRegex.exec(script)) !== null) getAssigned.add(m[1]);

  const out: Record<string, any> = {};
  Array.from(vars)
    .filter((name) => name !== "ENUMS")
    .filter((name) => name !== "COMMON")
    .filter((name) => !setAssigned.has(name))
    .filter((name) => !getAssigned.has(name))
    .sort()
    .forEach((name) => {
      out[name] = inferDefaultParamValue(name);
    });
  return out;
};

const PROMPT_MODE_LABELS: Record<PromptMode, string> = {
  CREATE: "Create",
  UPDATE: "Update",
  OPTIMIZE: "Optimize",
  API: "API",
};

const buildEntityContextLine = (entity: HAEntity): string => {
  const attrs = entity.attributes || {};
  const attrsPreview = Object.entries(attrs)
    .filter(([key]) =>
      [
        "friendly_name",
        "device_class",
        "unit_of_measurement",
        "supported_features",
        "source",
        "brightness",
        "temperature",
        "humidity",
      ].includes(key),
    )
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(", ");
  return `- ${entity.entity_id} | state=${JSON.stringify(entity.state)}${attrsPreview ? ` | attrs: ${attrsPreview}` : ""}`;
};

const buildPromptText = (params: {
  mode: PromptMode;
  scriptName: string;
  endpoint: string;
  scriptCode: string;
  selectedEntities: HAEntity[];
  userMessage: string;
  testParamsRaw: string;
}): string => {
  const {
    mode,
    scriptName,
    endpoint,
    scriptCode,
    selectedEntities,
    userMessage,
    testParamsRaw,
  } = params;
  const entitySection =
    selectedEntities.length > 0
      ? selectedEntities.map((entity) => buildEntityContextLine(entity)).join("\n")
      : "- No entities selected. Use only entities explicitly provided in user message.";
  const testParamsSection = testParamsRaw.trim() ? testParamsRaw : "{}";

  const modeInstruction =
    mode === "CREATE"
      ? [
          "Mode: CREATE",
          "Create a brand new HomeScript for this script endpoint. Do not reuse existing script code.",
          "Return only valid HomeScript code.",
        ].join("\n")
      : mode === "UPDATE"
        ? [
            "Mode: UPDATE",
            "Update the existing HomeScript based on my requested changes.",
            "Preserve existing behavior unless the request explicitly changes it.",
            "Return the full final HomeScript, not a diff.",
          ].join("\n")
        : mode === "OPTIMIZE"
          ? [
              "Mode: OPTIMIZE",
              "Optimize the current HomeScript for readability, safety, and maintainability while preserving behavior.",
              "Reduce redundant calls and simplify conditions where safe.",
              "Return the full optimized HomeScript.",
            ].join("\n")
          : [
              "Mode: API",
              "Generate HomeScript specifically for this API endpoint behavior and contract.",
              "Focus on request input validation, deterministic output, and safe SET/GET/CALL handling.",
              "Return full HomeScript code and include REQUIRED/OPTIONAL declarations when needed.",
            ].join("\n");

  const includeCurrentCode = mode === "UPDATE" || mode === "OPTIMIZE" || mode === "API";
  const currentCodeSection = includeCurrentCode
    ? `\nCurrent HomeScript code:\n\`\`\`homescript\n${scriptCode || "# empty"}\n\`\`\`\n`
    : "";

  const apiSection =
    mode === "API"
      ? [
          "API context:",
          `- Run endpoint: POST /api/run/${endpoint || "<endpoint>"}`,
          `- Webhook endpoint: POST /api/webhook/${endpoint || "<endpoint>"}`,
          "- Authentication for /api/run/*: Bearer token or valid service credentials.",
          "- /api/webhook/* may use signed webhook integration; avoid assumptions and implement defensive checks in script logic.",
        ].join("\n")
      : "";

  return [
    "You are an expert HomeScript generator.",
    "",
    modeInstruction,
    "",
    "Task context:",
    `- Script name: ${scriptName || "(unnamed script)"}`,
    `- Script endpoint: ${endpoint || "(missing endpoint)"}`,
    "",
    "HomeScript reference:",
    "- Use uppercase keywords: REQUIRED, OPTIONAL, IF/ELSE/END_IF, WHILE/END_WHILE, SET, GET, CALL, PRINT, TEST, FUNCTION/END_FUNCTION, RETURN, IMPORT.",
    "- REQUIRED/OPTIONAL declarations must be at the top of script.",
    "- GET syntax: GET domain.entity INTO $var.",
    "- SET syntax:",
    "  - Variable: SET $var = expression",
    "  - Entity state: SET domain.entity = expression",
    "- CALL syntax: CALL domain.service(args).",
    "- Keep logic deterministic and avoid invalid syntax.",
    "",
    "Built-in helper library reference:",
    HOME_SCRIPT_COMMON_LLM_REFERENCE,
    "",
    "Entity access context (available devices/states):",
    entitySection,
    "",
    "Input/test context (can be used for variable assumptions):",
    "```json",
    testParamsSection,
    "```",
    apiSection ? `\n${apiSection}\n` : "",
    currentCodeSection,
    "User request (append exactly):",
    userMessage?.trim() || "(No extra user message provided)",
    "",
    "Output requirements:",
    "- Return only final HomeScript code.",
    "- No markdown explanations.",
    "- Ensure it is runnable and complete.",
  ]
    .filter(Boolean)
    .join("\n");
};

export default function ScriptEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const monaco = useMonaco();
  const editorRef = useRef<any>(null);
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [code, setCode] = useState(`IF $temperature > 25
  CALL homeassistant.turn_on("switch.ac")
  PRINT "AC turned on"
ELSE
  PRINT "Temperature is fine"
END_IF`);
  const [mainCode, setMainCode] = useState(`IF $temperature > 25
  CALL homeassistant.turn_on("switch.ac")
  PRINT "AC turned on"
ELSE
  PRINT "Temperature is fine"
END_IF`);
  const [storedDebugCode, setStoredDebugCode] = useState<string | null>(null);
  const [debugLiveSyncStatus, setDebugLiveSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");
  const [output, setOutput] = useState<string[]>([]);
  const [variables, setVariables] = useState<Record<string, any>>({});
  const [testParams, setTestParams] = useState('{"temperature": 26}');
  const [mockDeviceStatesJson, setMockDeviceStatesJson] = useState("{}");
  const [debugDataMode, setDebugDataMode] = useState<DebugDataMode>("auto");
  const [debugPreset, setDebugPreset] = useState<keyof typeof DEBUG_PRESETS>("climate");
  const [triggerConfig, setTriggerConfig] = useState<ScriptTriggerConfig>(normalizeScriptTriggerConfig(defaultTriggerConfig));
  const [saving, setSaving] = useState(false);
  const [savePulse, setSavePulse] = useState(false);
  
  // HA Data for Autocomplete
  const [haEntities, setHaEntities] = useState<HAEntity[]>([]);
  const [haServices, setHaServices] = useState<HAServices>({});
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showRuleBuilder, setShowRuleBuilder] = useState(false);
  const [eventEditorDraft, setEventEditorDraft] = useState<ScriptTriggerConfig | null>(null);
  const [eventEditorNotice, setEventEditorNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Debugger State
  const [breakpoints, setBreakpoints] = useState<number[]>([]);
  const [isDebugging, setIsDebugging] = useState(false);
  const [currentLine, setCurrentLine] = useState<number | null>(null);
  const debugResolver = useRef<((action: "CONTINUE" | "STOP") => void) | null>(null);
  const debugStopRequestedRef = useRef(false);
  const debugPausedRef = useRef(false);
  const [debugPaused, setDebugPaused] = useState(false);
  const [showDebugMenu, setShowDebugMenu] = useState(false);
  const [debugToolsEnabled, setDebugToolsEnabled] = useState(false);
  const debugToolsEnabledRef = useRef(false);
  const [debugLineDelayMs, setDebugLineDelayMs] = useState(180);
  const [debugMissingParams, setDebugMissingParams] = useState<string[]>([]);
  const [debugPromotePulse, setDebugPromotePulse] = useState(false);
  const saveHandlerRef = useRef<(() => Promise<void>) | null>(null);
  const decorationIds = useRef<string[]>([]);
  const completionProviderRef = useRef<any>(null);
  const foldingProviderRef = useRef<any>(null);
  const homescriptLangRegisteredRef = useRef(false);
  const remoteReplayTimerRef = useRef<number | null>(null);
  const lastRemoteSessionIdRef = useRef<string | null>(null);
  const debugDraftSyncTimerRef = useRef<number | null>(null);
  const debugEnabledAtRef = useRef<number | null>(null);
  const eventEditorNoticeTimerRef = useRef<number | null>(null);
  const metaAutoCollapsedRef = useRef(false);
  const metaUserExpandedRef = useRef(false);
  const collapseMetaTimerRef = useRef<number | null>(null);

  const [services, setServices] = useState<any[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [executionEvents, setExecutionEvents] = useState<ExecutionEvent[]>([]);
  const [haStateEvents, setHaStateEvents] = useState<HAStateEvent[]>([]);
  const [backendMeta, setBackendMeta] = useState<BackendRunMeta | null>(null);
  const [frontendMeta, setFrontendMeta] = useState<Record<string, any> | null>(null);
  const [debugInputError, setDebugInputError] = useState<string | null>(null);
  const [promptMode, setPromptMode] = useState<PromptMode>("CREATE");
  const [promptUserMessage, setPromptUserMessage] = useState("");
  const [promptEntitySearch, setPromptEntitySearch] = useState("");
  const [promptSelectedEntityIds, setPromptSelectedEntityIds] = useState<string[]>([]);
  const [promptCopied, setPromptCopied] = useState(false);
  const [showPromptGenerator, setShowPromptGenerator] = useState(false);
  const promptEntityTouchedRef = useRef(false);
  const promptCopiedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    debugToolsEnabledRef.current = debugToolsEnabled;
  }, [debugToolsEnabled]);

  useEffect(() => {
    if (id) return;
    const saved = localStorage.getItem("script_editor_debug_tools_enabled_new");
    setDebugToolsEnabled(saved === "true");
  }, [id]);

  useEffect(() => {
    if (id) return;
    localStorage.setItem("script_editor_debug_tools_enabled_new", debugToolsEnabled ? "true" : "false");
  }, [id, debugToolsEnabled]);

  const addEvent = (event: Omit<ExecutionEvent, "id" | "timestamp">) => {
    setExecutionEvents((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        ...event,
      },
    ]);
  };

  const resetExecutionConsole = () => {
    setExecutionEvents([]);
    setHaStateEvents([]);
    setBackendMeta(null);
    setFrontendMeta(null);
  };

  const promptBodyCode = useMemo(() => splitMetaBlocks(code).body, [code]);
  const promptReferencedEntityIds = useMemo(
    () => extractEntityIdsFromCode(promptBodyCode, triggerConfig),
    [promptBodyCode, triggerConfig],
  );
  const promptEntityMap = useMemo(() => {
    const map = new Map<string, HAEntity>();
    haEntities.forEach((entity) => map.set(entity.entity_id, entity));
    return map;
  }, [haEntities]);
  const promptSelectedEntities = useMemo(
    () => promptSelectedEntityIds.map((idValue) => promptEntityMap.get(idValue)).filter((entity): entity is HAEntity => Boolean(entity)),
    [promptEntityMap, promptSelectedEntityIds],
  );
  const promptVisibleEntities = useMemo(() => {
    const query = promptEntitySearch.trim().toLowerCase();
    const sorted = [...haEntities].sort((a, b) => a.entity_id.localeCompare(b.entity_id));
    if (!query) return sorted.slice(0, 200);
    return sorted
      .filter((entity) => {
        const friendly = String(entity.attributes?.friendly_name || "").toLowerCase();
        return entity.entity_id.toLowerCase().includes(query) || friendly.includes(query);
      })
      .slice(0, 200);
  }, [haEntities, promptEntitySearch]);
  const promptGeneratedText = useMemo(
    () =>
      buildPromptText({
        mode: promptMode,
        scriptName: name.trim(),
        endpoint: endpoint.trim(),
        scriptCode: promptBodyCode,
        selectedEntities: promptSelectedEntities,
        userMessage: promptUserMessage,
        testParamsRaw: testParams,
      }),
    [promptMode, name, endpoint, promptBodyCode, promptSelectedEntities, promptUserMessage, testParams],
  );

  useEffect(() => {
    if (promptEntityTouchedRef.current) return;
    if (haEntities.length === 0) return;
    const autoIds = promptReferencedEntityIds.filter((entityId) => promptEntityMap.has(entityId));
    if (autoIds.length === 0) return;
    setPromptSelectedEntityIds(autoIds);
  }, [haEntities, promptReferencedEntityIds, promptEntityMap]);

  useEffect(() => () => {
    if (promptCopiedTimerRef.current) {
      window.clearTimeout(promptCopiedTimerRef.current);
      promptCopiedTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!showPromptGenerator) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowPromptGenerator(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showPromptGenerator]);

  const togglePromptEntity = (entityId: string) => {
    promptEntityTouchedRef.current = true;
    setPromptSelectedEntityIds((prev) => {
      if (prev.includes(entityId)) {
        return prev.filter((value) => value !== entityId);
      }
      return [...prev, entityId];
    });
  };

  const handlePromptCopy = async () => {
    try {
      await navigator.clipboard.writeText(promptGeneratedText);
      setPromptCopied(true);
      if (promptCopiedTimerRef.current) {
        window.clearTimeout(promptCopiedTimerRef.current);
      }
      promptCopiedTimerRef.current = window.setTimeout(() => {
        setPromptCopied(false);
      }, 1800);
    } catch {
      setPromptCopied(false);
      addEvent({
        source: "frontend",
        level: "error",
        message: "Failed to copy prompt to clipboard",
      });
    }
  };

  const applyRemoteDebugReplay = (payload: any, createdAt: string) => {
    const traceEvents = Array.isArray(payload?.traceEvents) ? payload.traceEvents : [];
    const mappedEvents: ExecutionEvent[] = traceEvents.map((ev: any, idx: number) => ({
      id: `remote-${Date.now()}-${idx}`,
      timestamp: createdAt || new Date().toISOString(),
      source: "engine",
      level:
        ev?.level === "error"
          ? "error"
          : ev?.level === "success"
            ? "success"
            : ev?.level === "warning"
              ? "warning"
              : "info",
      message: String(ev?.message || ev?.type || "trace"),
      line: Number.isInteger(ev?.line) ? ev.line : undefined,
    }));

    setExecutionEvents(mappedEvents);
    setHaStateEvents([]);
    setBackendMeta(null);
    setFrontendMeta({
      mode: "remote_debug_replay",
      source: payload?.source || "unknown",
      receivedAt: new Date().toISOString(),
      sessionCreatedAt: createdAt,
      breakpoints: payload?.breakpoints || [],
      runCommand: {
        mode: "remote_debug_replay",
        endpoint: endpoint || "test",
        source: payload?.source || "unknown",
        lineDelayMs: payload?.lineDelayMs,
        requestedBreakpoints: payload?.requestedBreakpoints || [],
        effectiveBreakpoints: payload?.breakpoints || [],
        serviceCalls: payload?.serviceCalls || [],
        mockStates: payload?.mockStates || {},
        debugToolsEnabled,
      },
    });
    setOutput(Array.isArray(payload?.output) ? payload.output.map((x: any) => String(x)) : payload?.error ? [`Error: ${payload.error}`] : []);
    setVariables(payload?.variables && typeof payload.variables === "object" ? payload.variables : {});

    const lines = traceEvents
      .filter((ev: any) => ev?.type === "line_execute" && Number.isInteger(ev?.line))
      .map((ev: any) => Number(ev.line));
    // Keep only user-defined editor breakpoints. Remote replay should not overwrite them.
    setCurrentLine(null);

    if (remoteReplayTimerRef.current) {
      window.clearInterval(remoteReplayTimerRef.current);
      remoteReplayTimerRef.current = null;
    }
    if (lines.length === 0) return;
    const intervalMs = Math.max(60, Number(payload?.lineDelayMs) || 180);
    let idx = -1;
    remoteReplayTimerRef.current = window.setInterval(() => {
      idx += 1;
      setCurrentLine(lines[idx] || null);
      if (idx >= lines.length - 1 && remoteReplayTimerRef.current) {
        window.clearInterval(remoteReplayTimerRef.current);
        remoteReplayTimerRef.current = null;
      }
    }, intervalMs);
  };

  const pushEventEditorNotice = (type: "success" | "error", message: string) => {
    setEventEditorNotice({ type, message });
    if (eventEditorNoticeTimerRef.current) {
      window.clearTimeout(eventEditorNoticeTimerRef.current);
      eventEditorNoticeTimerRef.current = null;
    }
    eventEditorNoticeTimerRef.current = window.setTimeout(() => {
      setEventEditorNotice(null);
    }, 2600);
  };

  const handleCodeChange = (nextCode: string) => {
    setCode(nextCode);
    if (!debugToolsEnabled) {
      setMainCode(nextCode);
    }
  };

  const openEventEditor = () => {
    const parsed = tryParseTriggerConfigFromBlocks(code, triggerConfig);
    if (parsed) {
      setEventEditorDraft(parsed);
      pushEventEditorNotice("success", "Loaded event config from code blocks.");
    } else {
      setEventEditorDraft(normalizeScriptTriggerConfig(triggerConfig));
      pushEventEditorNotice("error", "Could not parse event blocks from code. Loaded last saved config.");
    }
    setShowRuleBuilder(true);
  };

  const saveEventEditor = () => {
    if (!eventEditorDraft) {
      pushEventEditorNotice("error", "Event editor has no draft to save.");
      return;
    }
    const normalized = normalizeScriptTriggerConfig(eventEditorDraft);
    const nextCode = composeCodeWithMeta(code, normalized);
    setCode(nextCode);
    if (!debugToolsEnabled) setMainCode(nextCode);
    setTriggerConfig(normalized);
    setShowRuleBuilder(false);
    pushEventEditorNotice("success", "Event blocks saved into script.");
  };

  const getMetaHeaderLines = (source: string) => {
    const lines = String(source || "").split("\n");
    const out: number[] = [];
    lines.forEach((raw, idx) => {
      const t = raw.trim();
      if (t.startsWith(EVENTS_HEADER) || t.startsWith(EVENT_EXPRESSION_HEADER)) out.push(idx + 1);
    });
    return out;
  };

  const collapseMetaBlocksIfNeeded = (force = false) => {
    const editor = editorRef.current;
    if (!editor || !debugToolsEnabled) return;
    if (metaUserExpandedRef.current && !force) return;
    const model = editor.getModel?.();
    const value = model?.getValue?.() ?? code;
    const headerLines = getMetaHeaderLines(value);
    if (headerLines.length === 0) return;
    const hiddenAreas = editor.getHiddenAreas?.() || [];
    const isHidden = (line: number) =>
      hiddenAreas.some((r: any) => line >= r.startLineNumber && line <= r.endLineNumber);
    headerLines.forEach((lineNumber) => {
      if (isHidden(lineNumber)) return;
      editor.setPosition?.({ lineNumber, column: 1 });
      const foldAction = editor.getAction?.("editor.fold");
      const maybePromise = foldAction?.run?.();
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.catch(() => {
          // Monaco can cancel fold actions during rapid model updates.
        });
      }
    });
    metaAutoCollapsedRef.current = true;
  };

  const toggleDebugTools = async () => {
    const persistMode = async (enabled: boolean) => {
      if (!id) return;
      try {
        const token = localStorage.getItem("auth_token");
        await fetch(`/api/scripts/${id}/debug`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ debugEnabled: enabled }),
        });
      } catch {
        // Best-effort mode persistence.
      }
    };

    if (debugToolsEnabled) {
      setDebugToolsEnabled(false);
      setShowDebugMenu(false);
      setBreakpoints([]);
      setCode(mainCode);
      setDebugLiveSyncStatus("idle");
      lastRemoteSessionIdRef.current = null;
      metaAutoCollapsedRef.current = false;
      metaUserExpandedRef.current = false;
      await persistMode(false);
      if (remoteReplayTimerRef.current) {
        window.clearInterval(remoteReplayTimerRef.current);
        remoteReplayTimerRef.current = null;
      }
      return;
    }

    setMainCode(code);
    let nextDebugCode = storedDebugCode;
    if (id) {
      try {
        const token = localStorage.getItem("auth_token");
        const res = await fetch(`/api/scripts/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          nextDebugCode = typeof data.debug_code === "string" ? data.debug_code : null;
          setStoredDebugCode(nextDebugCode);
        }
      } catch {
        // Best-effort refresh of latest debug draft.
      }
    }

    setDebugToolsEnabled(true);
    setShowDebugMenu(true);
    debugEnabledAtRef.current = Date.now();
    metaAutoCollapsedRef.current = false;
    metaUserExpandedRef.current = false;
    await persistMode(true);
    const source = nextDebugCode && nextDebugCode.trim().length > 0 ? nextDebugCode : code;
    setCode(composeCodeWithMeta(splitMetaBlocks(source).body, triggerConfig));
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveHandlerRef.current?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Load cached HA data on mount
  useEffect(() => {
    const cachedEntities = localStorage.getItem("ha_entities");
    const cachedServices = localStorage.getItem("ha_services");
    if (cachedEntities) setHaEntities(JSON.parse(cachedEntities));
    if (cachedServices) setHaServices(JSON.parse(cachedServices));

    // Also try to fetch fresh data from server
    const token = localStorage.getItem("auth_token");
    if (token) {
      fetch("/api/states", { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data) && data.length > 0) {
            setHaEntities(data);
            localStorage.setItem("ha_entities", JSON.stringify(data));
          }
        })
        .catch(() => {});
        
      fetch("/api/services", { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => {
          if (data && !Array.isArray(data)) {
             // Wait, /api/services returns an array in the mock, but we need HAServices object
             // Let's check how it's handled.
          }
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!editorRef.current || !monaco) return;
    
    const newDecorations: any[] = [];

    breakpoints.forEach((line) => {
      newDecorations.push({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: false,
          glyphMarginClassName: "breakpoint-glyph",
        }
      });
    });

    if (currentLine) {
       newDecorations.push({
        range: new monaco.Range(currentLine, 1, currentLine, 1),
        options: {
          isWholeLine: true,
          className: "current-line-highlight",
        }
      });
      editorRef.current.revealLineInCenter(currentLine);
    }

    decorationIds.current = editorRef.current.deltaDecorations(decorationIds.current, newDecorations);
  }, [breakpoints, currentLine, monaco]);

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    fetch("/api/services", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((res) => res.json())
      .then((data) => setServices(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (monaco) {
      // Register HomeScript Language
      if (!homescriptLangRegisteredRef.current) {
        monaco.languages.register({ id: "homescript" });
        homescriptLangRegisteredRef.current = true;
      }

      // Syntax Highlighting
      monaco.languages.setMonarchTokensProvider("homescript", {
        tokenizer: {
          root: [
            [/^(\s*)([@]events)(\s*)(\{)/, ["white", "meta.block.tag", "white", "json.delimiter.bracket"], "@metaJson"],
            [/^(\s*)([@]event_expression)(\s*)(\{)/, ["white", "meta.block.tag", "white", "json.delimiter.bracket"], "@metaJson"],
            [/^(\s*LABEL)(\s+)([a-zA-Z_][a-zA-Z0-9_]*)/, ["keyword.flow", "", "label.name"]],
            [/^(\s*GOTO)(\s+)([a-zA-Z_][a-zA-Z0-9_]*)/, ["keyword.flow", "", "label.name"]],
            [/\b(REQUIRED|OPTIONAL)\b/, "keyword.decl"],
            [/\b(IF|ELSE|END_IF|WHILE|DO|END_WHILE|SET|PRINT|GET|INTO|CALL|BREAK|CONTINUE|FUNCTION|END_FUNCTION|RETURN|IMPORT|AND|OR|NOT|GOTO|LABEL|IN|TEST)\b/, "keyword.flow"],
            [/\$[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*/, "variable"],
            [/[a-z_]+\.[a-z_]+/, "function"], // Highlight domain.service calls
            [/\/(?:\\.|[^\/\\\n]|\[(?:\\.|[^\]\\\n])*\])+\/[dgimsuvy]*/, "regexp"],
            [/"/, { token: "string.quote", next: "@string" }],
            [/\d+/, "number"],
            [/#.*/, "comment"],
          ],
          string: [
            [/\$[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*/, "variable"],
            [/[^\\$"]+/, "string"],
            [/\\./, "string.escape"],
            [/"/, { token: "string.quote", next: "@pop" }],
          ],
          metaJson: [
            [/\}/, { token: "json.delimiter.bracket", next: "@pop" }],
            [/\{/, "json.delimiter.bracket"],
            [/\[/, "json.delimiter.array"],
            [/\]/, "json.delimiter.array"],
            [/,/, "json.delimiter.comma"],
            [/:/, "json.delimiter.colon"],
            [/"([^"\\]|\\.)*"/, "json.string"],
            [/-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?/, "json.number"],
            [/\b(true|false)\b/, "json.boolean"],
            [/\bnull\b/, "json.null"],
            [/[A-Za-z_][A-Za-z0-9_]*/, "json.property"],
            [/\s+/, "white"],
          ],
        },
      });

      // Folding for @events / @event_expression blocks
      foldingProviderRef.current?.dispose?.();
      foldingProviderRef.current = monaco.languages.registerFoldingRangeProvider("homescript", {
        provideFoldingRanges: (model) => {
          const ranges: any[] = [];
          const lineCount = model.getLineCount();
          const allLines = Array.from({ length: lineCount }, (_, idx) => model.getLineContent(idx + 1));
          for (let ln = 1; ln <= lineCount; ln += 1) {
            const trimmed = model.getLineContent(ln).trim();
            if (trimmed === EVENTS_HEADER || trimmed === EVENT_EXPRESSION_HEADER) {
              const endIdx = findMatchingBraceLine(allLines, ln - 1);
              const end = endIdx >= 0 ? endIdx + 1 : -1;
              if (end > ln) {
                ranges.push({
                  start: ln,
                  end,
                  kind: monaco.languages.FoldingRangeKind.Region,
                });
              }
            }
          }
          return ranges;
        },
      });

      // Autocomplete
      completionProviderRef.current?.dispose?.();
      const buildCommonLibSuggestions = createCommonLibMonacoSuggestionFactory(monaco);
      completionProviderRef.current = monaco.languages.registerCompletionItemProvider("homescript", {
        provideCompletionItems: (model, position) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };

          const suggestions: any[] = [
            {
              label: "@events block",
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText:
                '@events {\n  "logic": "OR",\n  "rules": [\n    {\n      "id": "rule-${1:id}",\n      "name": "${2:Event 1}",\n      "entityId": "${3:light.kitchen}",\n      "eventType": "toggle",\n      "toggleFrom": "any",\n      "toggleTo": "any",\n      "toggleFromCustom": "",\n      "toggleToCustom": "",\n      "previewScale": "linear",\n      "levels": [\n        { "id": "level-1", "name": "Level 1", "value": 25 },\n        { "id": "level-2", "name": "Level 2", "value": 50 },\n        { "id": "level-3", "name": "Level 3", "value": 75 }\n      ],\n      "rangeMin": 0,\n      "rangeMax": 100\n    }\n  ]\n}\n@event_expression {\n$0\n}\n',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: "@event_expression sample",
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: '@event_expression {\n$${1:EVENT_1} AND $${1:EVENT_1}_VALUE == "on"\n}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: "REQUIRED",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: "REQUIRED $${1:param_name} IF (${2:condition})",
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: "OPTIONAL",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: "OPTIONAL $${1:param_name} = ${2:default_value} IF (${3:condition})",
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: "LABEL",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: "LABEL ${1:label_name}",
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: "GOTO",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: "GOTO ${1:label_name}",
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: "BREAK",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'BREAK ${1:404} "${2:message}"',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: "TEST",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'TEST ${1:$value} /${2:pattern}/${3:i} INTO $${4:is_valid}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: "IN",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: "IN",
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: "FUNCTION",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: "FUNCTION ${1:name}(${2:args})\n\t$0\nEND_FUNCTION",
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: "RETURN",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: "RETURN",
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: "IMPORT",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'IMPORT "${1:script_name}"',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: "IF",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: "IF ${1:condition}\n\t$0\nEND_IF",
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: "WHILE",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: "WHILE ${1:condition} DO\n\t$0\nEND_WHILE",
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: "AND",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: "AND",
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: "OR",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: "OR",
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: "NOT",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: "NOT",
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: "SET",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: "SET $${1:var} = ${2:value}",
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: "PRINT",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'PRINT "${1:message}"',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: "CALL",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'CALL ${1:service}(${2:args})',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            {
              label: "GET",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'GET ${1:entity_id} INTO $${2:var}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
          ];

          suggestions.push(...buildCommonLibSuggestions(range));

          // Dynamically add services from HA
          if (Object.keys(haServices).length > 0) {
            Object.entries(haServices).forEach(([domain, domainServices]) => {
              Object.keys(domainServices).forEach((serviceName) => {
                const fullName = `${domain}.${serviceName}`;
                suggestions.push({
                  label: fullName,
                  kind: monaco.languages.CompletionItemKind.Function,
                  insertText: `${fullName}("\${1:entity_id}")`,
                  insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  range,
                  detail: "Home Assistant Service"
                });
              });
            });
          } else {
            // Fallback to mock services if no HA data
            services.forEach((domainObj: any) => {
              if (domainObj.services) {
                const serviceNames = Array.isArray(domainObj.services) 
                  ? domainObj.services 
                  : Object.keys(domainObj.services);
                  
                serviceNames.forEach((serviceName: string) => {
                  const fullName = `${domainObj.domain}.${serviceName}`;
                  suggestions.push({
                    label: fullName,
                    kind: monaco.languages.CompletionItemKind.Function,
                    insertText: `${fullName}("\${1:entity_id}")`,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range,
                  });
                });
              }
            });
          }

          // Add Entity IDs as suggestions when inside quotes
          const lineContent = model.getLineContent(position.lineNumber);
          const textBeforeCursor = lineContent.substring(0, position.column - 1);
          
          // Simple check if we are likely inside a string or function call
          if (textBeforeCursor.match(/["']$/) || textBeforeCursor.match(/\($/)) {
             haEntities.forEach(entity => {
                 suggestions.push({
                     label: entity.entity_id,
                     kind: monaco.languages.CompletionItemKind.Value,
                     insertText: entity.entity_id,
                     range,
                     detail: entity.attributes.friendly_name || entity.state
                 });
             });
          }

          const seen = new Set<string>();
          const deduped = suggestions.filter((item) => {
            const key = `${item.label}::${item.insertText}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          return { suggestions: deduped };
        },
      });

      // Theme Configuration
      monaco.editor.defineTheme("homescript-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "keyword.flow", foreground: "C586C0", fontStyle: "bold" },
          { token: "keyword.decl", foreground: "4FC1FF", fontStyle: "bold" },
          { token: "meta.block.tag", foreground: "F97316", fontStyle: "bold" },
          { token: "json.property", foreground: "9CDCFE" },
          { token: "json.string", foreground: "CE9178" },
          { token: "json.number", foreground: "B5CEA8" },
          { token: "json.boolean", foreground: "569CD6", fontStyle: "bold" },
          { token: "json.null", foreground: "569CD6" },
          { token: "json.delimiter.bracket", foreground: "D4D4D4" },
          { token: "json.delimiter.array", foreground: "D4D4D4" },
          { token: "json.delimiter.comma", foreground: "D4D4D4" },
          { token: "json.delimiter.colon", foreground: "D4D4D4" },
          { token: "variable", foreground: "9CDCFE" },
          { token: "function", foreground: "DCDCAA" }, // Function color
          { token: "label.name", foreground: "FF8C00", fontStyle: "italic bold" },
          { token: "string", foreground: "CE9178" },
          { token: "regexp", foreground: "FF6B6B", fontStyle: "bold" },
          { token: "number", foreground: "B5CEA8" },
          { token: "comment", foreground: "6A9955", fontStyle: "italic" },
        ],
        colors: {
          "editor.background": "#18181b", // zinc-950
        },
      });

      // Apply Theme
      monaco.editor.setTheme("homescript-dark");
    }
    return () => {
      completionProviderRef.current?.dispose?.();
      completionProviderRef.current = null;
      foldingProviderRef.current?.dispose?.();
      foldingProviderRef.current = null;
    };
  }, [monaco, services, haServices, haEntities]);

  useEffect(() => {
    if (!editorRef.current || !monaco) return;
    const model = editorRef.current.getModel();
    if (!model) return;
    const diagnostics = validateHomeScript(sanitizeCodeForExecution(code));
    const markers = diagnostics.map((d) => ({
      startLineNumber: d.line,
      startColumn: 1,
      endLineNumber: d.line,
      endColumn: model.getLineContent(d.line).length + 1,
      message: d.message,
      severity: monaco.MarkerSeverity.Error,
    }));
    monaco.editor.setModelMarkers(model, "homescript-lint", markers);
  }, [code, monaco]);

  useEffect(() => {
    if (id) {
      const token = localStorage.getItem("auth_token");
      fetch(`/api/scripts/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then((res) => res.json())
        .then((data) => {
          const parsedTriggerConfig = (() => {
            if (data.trigger_config) {
              try {
                return normalizeScriptTriggerConfig(JSON.parse(data.trigger_config));
              } catch {
                return normalizeScriptTriggerConfig({});
              }
            }
            return normalizeScriptTriggerConfig({});
          })();
          setName(data.name);
          setEndpoint(data.endpoint);
          const persistedDebugEnabled = Boolean(data.debug_enabled);
          const incomingDebugCode = typeof data.debug_code === "string" ? data.debug_code : null;
          const sourceCode = persistedDebugEnabled && incomingDebugCode && incomingDebugCode.trim().length > 0 ? incomingDebugCode : data.code;
          const nextCode = composeCodeWithMeta(splitMetaBlocks(sourceCode).body, parsedTriggerConfig);
          setDebugToolsEnabled(persistedDebugEnabled);
          setShowDebugMenu(persistedDebugEnabled);
          debugEnabledAtRef.current = persistedDebugEnabled ? Date.now() : null;
          setCode(nextCode);
          setMainCode(composeCodeWithMeta(splitMetaBlocks(data.code).body, parsedTriggerConfig));
          setStoredDebugCode(incomingDebugCode);
          if (data.test_params) {
            setTestParams(data.test_params);
          }
          const savedMockStates = localStorage.getItem(`script_mock_states_${data.id || id}`);
          if (savedMockStates) {
            setMockDeviceStatesJson(savedMockStates);
          }
          setTriggerConfig(parsedTriggerConfig);
        });
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    localStorage.setItem(`script_mock_states_${id}`, mockDeviceStatesJson);
  }, [id, mockDeviceStatesJson]);

  const handleSave = async () => {
    let finalName = name.trim();
    let finalEndpoint = endpoint.trim();

    if (!finalName && !finalEndpoint) {
      setSaveError("Script Name or Endpoint is required");
      return;
    }

    if (!finalName) {
      finalName = finalEndpoint;
      setName(finalName);
    }

    if (!finalEndpoint) {
      finalEndpoint = finalName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      setEndpoint(finalEndpoint);
    }

    const codeToSave = debugToolsEnabled ? mainCode : code;
    if (!codeToSave.trim()) {
      setSaveError("Script code is required");
      return;
    }
    const effectiveTriggerConfig = tryParseTriggerConfigFromBlocks(codeToSave, triggerConfig) || triggerConfig;
    setTriggerConfig(effectiveTriggerConfig);

    setSaving(true);
    setSaveError(null);
    const method = id ? "PUT" : "POST";
    const url = id ? `/api/scripts/${id}` : "/api/scripts";
    const token = localStorage.getItem("auth_token");

    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        name: finalName,
        endpoint: finalEndpoint,
        code: codeToSave,
        testParams,
        triggerConfig: JSON.stringify(effectiveTriggerConfig),
      }),
    });

    setSaving(false);
    if (res.ok) {
      const data = await res.json();
      setSaveError(null);
      setSavePulse(true);
      window.setTimeout(() => setSavePulse(false), 550);
      if (!id) navigate(`/scripts/${data.id}`);
    } else {
      const err = await res.json();
      setSaveError(err.error);
    }
  };

  useEffect(() => {
    saveHandlerRef.current = handleSave;
  }, [handleSave]);

  const clearMarkers = () => {
    if (editorRef.current && monaco) {
      const model = editorRef.current.getModel();
      monaco.editor.setModelMarkers(model, "owner", []);
    }
  };

  const setErrorMarker = (line: number, message: string) => {
    if (editorRef.current && monaco) {
      const model = editorRef.current.getModel();
      monaco.editor.setModelMarkers(model, "owner", [{
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: model.getLineContent(line).length + 1,
        message: message,
        severity: monaco.MarkerSeverity.Error
      }]);
    }
  };

  const applyExecutionReport = (report: ExecutionReport) => {
    setExecutionEvents((prev) => [...prev, ...report.events]);
    setHaStateEvents(report.haStates);
    setBackendMeta(report.meta);
  };

  const generateRandomizedDebugParams = (base: Record<string, any>) => {
    const randomized: Record<string, any> = {};
    Object.entries(base).forEach(([key, value]) => {
      if (typeof value === "number") {
        const delta = Math.max(1, Math.round(Math.abs(value) * 0.25));
        randomized[key] = Number((value + (Math.random() * 2 - 1) * delta).toFixed(2));
      } else if (typeof value === "boolean") {
        randomized[key] = Math.random() > 0.5;
      } else {
        randomized[key] = value;
      }
    });
    randomized.__randomized_at = new Date().toISOString();
    return randomized;
  };

  const parseJsonObject = (raw: string, label: string) => {
    try {
      const parsed = JSON.parse(raw || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`${label} must be a JSON object`);
      }
      return parsed as Record<string, any>;
    } catch (e: any) {
      throw new Error(e?.message || `Invalid JSON in ${label}`);
    }
  };

  const buildAutoInputBundle = () => {
    const bodyCode = splitMetaBlocks(code).body;
    const autoParams = buildAutoParamsFromCode(bodyCode);
    const entityIds = extractEntityIdsFromCode(bodyCode, triggerConfig);
    const autoMockStates: Record<string, any> = {};
    entityIds.forEach((entityId) => {
      const found = haEntities.find((e) => e.entity_id === entityId);
      autoMockStates[entityId] = found ? found.state : "unknown";
    });
    return { autoParams, autoMockStates };
  };

  const applyAutoGeneratedInputs = () => {
    const { autoParams, autoMockStates } = buildAutoInputBundle();
    setTestParams(JSON.stringify(autoParams, null, 2));
    setMockDeviceStatesJson(JSON.stringify(autoMockStates, null, 2));
    setDebugInputError(null);
  };

  const getKnownParamNames = () => {
    const autoParamNames = Object.keys(buildAutoInputBundle().autoParams);
    try {
      const manual = JSON.parse(testParams || "{}");
      if (manual && typeof manual === "object" && !Array.isArray(manual)) {
        return Array.from(new Set([...autoParamNames, ...Object.keys(manual)])).sort();
      }
    } catch {
      // Ignore invalid manual JSON; auto names are still usable.
    }
    return autoParamNames;
  };

  const toggleMissingParam = (name: string) => {
    setDebugMissingParams((prev) => (prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]));
  };

  useEffect(() => {
    const { autoParams, autoMockStates } = buildAutoInputBundle();
    const autoParamsJson = JSON.stringify(autoParams, null, 2);
    const autoMockStatesJson = JSON.stringify(autoMockStates, null, 2);
    const trimmedMock = mockDeviceStatesJson.trim();
    const isMockEmpty = !trimmedMock || trimmedMock === "{}";

    if (debugDataMode === "auto" && testParams !== autoParamsJson) {
      setTestParams(autoParamsJson);
    }
    if ((debugDataMode === "auto" || isMockEmpty) && mockDeviceStatesJson !== autoMockStatesJson) {
      setMockDeviceStatesJson(autoMockStatesJson);
    }
  }, [code, triggerConfig, haEntities, debugDataMode]);

  const resolveRuntimeInputs = (mode: DebugDataMode, autoFallback: boolean) => {
    const { autoParams, autoMockStates } = buildAutoInputBundle();
    let params: Record<string, any> = {};
    let paramsFallback = false;

    try {
      if (mode === "auto") {
        params = autoParams;
        setTestParams(JSON.stringify(params, null, 2));
      } else if (mode === "manual") {
        const manual = parseJsonObject(testParams, "test parameters");
        params = { ...autoParams, ...manual };
      } else {
        const presetData = DEBUG_PRESETS[debugPreset];
        const payload = mode === "randomized" ? generateRandomizedDebugParams(presetData) : presetData;
        params = { ...autoParams, ...payload };
        setTestParams(JSON.stringify(params, null, 2));
      }
    } catch (e) {
      if (!autoFallback) throw e;
      params = autoParams;
      paramsFallback = true;
      setTestParams(JSON.stringify(params, null, 2));
    }

    let mockStates: Record<string, any>;
    try {
      const manualMockStates = parseJsonObject(mockDeviceStatesJson, "mock device states");
      mockStates = { ...autoMockStates, ...manualMockStates };
    } catch (e) {
      if (!autoFallback) throw e;
      mockStates = autoMockStates;
      setMockDeviceStatesJson(JSON.stringify(mockStates, null, 2));
    }

    return { params, mockStates, paramsFallback };
  };

  const handleRunServer = async () => {
    clearMarkers();
    resetExecutionConsole();
    const runStart = performance.now();
    addEvent({
      source: "frontend",
      level: "info",
      message: "Server run started",
      details: { endpoint: endpoint || "test" },
    });
    let params = {};
    try {
      const resolved = resolveRuntimeInputs(debugDataMode, true);
      params = resolved.params;
      if (resolved.paramsFallback) {
        addEvent({
          source: "frontend",
          level: "warning",
          message: "Manual test params were invalid. Auto-generated params were used.",
        });
      }
      setDebugInputError(null);
      addEvent({
        source: "frontend",
        level: "success",
        message: "Test parameters parsed",
      });
    } catch (e) {
      const message = (e as any)?.message || "Invalid JSON in test parameters";
      setOutput([`Error: ${message}`]);
      setDebugInputError(message);
      setFrontendMeta({
        mode: "server",
        parseOk: false,
        durationMs: Math.round(performance.now() - runStart),
        runCommand: {
          mode: "server",
          endpoint: endpoint || "test",
          params,
          parseError: message,
          debugToolsEnabled,
        },
      });
      addEvent({
        source: "frontend",
        level: "error",
        message,
      });
      return;
    }

    const token = localStorage.getItem("auth_token");
    const res = await fetch(`/api/run/${endpoint || 'test'}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(params),
    });

    const data = await res.json();
    setFrontendMeta({
      mode: "server",
      parseOk: true,
      endpoint: endpoint || "test",
      status: res.status,
      durationMs: Math.round(performance.now() - runStart),
      runCommand: {
        mode: "server",
        endpoint: endpoint || "test",
        params,
        debugToolsEnabled,
      },
    });
    addEvent({
      source: "frontend",
      level: res.ok ? "success" : "error",
      message: `Server responded with ${res.status}`,
      details: { endpoint: endpoint || "test" },
    });

    if (data.report) {
      applyExecutionReport(data.report as ExecutionReport);
    }

    if (res.ok) {
      setOutput(data.output);
      setVariables(data.variables);
    } else {
      setOutput([`Error: ${data.error}`]);
      if (data.line) {
        setErrorMarker(data.line, data.error);
      }
    }
  };

  const handleDebug = async () => {
    clearMarkers();
    resetExecutionConsole();
    setIsDebugging(true);
    setDebugPaused(false);
    debugPausedRef.current = false;
    setCurrentLine(null);
    debugStopRequestedRef.current = false;
    addEvent({
      source: "frontend",
      level: "info",
      message: "Debug session started",
    });
    
    let params = {};
    let runtimeMockStates: Record<string, any> = {};
    try {
      const resolved = resolveRuntimeInputs(debugDataMode, true);
      params = { ...resolved.params };
      runtimeMockStates = { ...resolved.mockStates };
      debugMissingParams.forEach((name) => {
        delete (params as Record<string, any>)[name];
      });
      if (resolved.paramsFallback) {
        addEvent({
          source: "frontend",
          level: "warning",
          message: "Manual test params were invalid. Auto-generated params were used.",
        });
      }
      if (debugMissingParams.length > 0) {
        addEvent({
          source: "frontend",
          level: "warning",
          message: "Debug run with missing params simulation",
          details: { removed: [...debugMissingParams] },
        });
      }
      setDebugInputError(null);
    } catch (e) {
      const message = (e as any)?.message || "Invalid JSON in test parameters";
      setOutput([`Error: ${message}`]);
      setDebugInputError(message);
      setIsDebugging(false);
      setFrontendMeta({
        mode: "debug",
        parseOk: false,
      runCommand: {
        mode: "debug",
        parseError: message,
        debugToolsEnabled,
      },
    });
      addEvent({
        source: "frontend",
        level: "error",
        message,
      });
      return;
    }
    setFrontendMeta({
      mode: "debug",
      parseOk: true,
      lineDelayMs: debugLineDelayMs,
      missingParams: [...debugMissingParams],
      runCommand: {
        mode: "debug",
        lineDelayMs: debugLineDelayMs,
        breakpoints: [...breakpoints],
        params,
        mockStates: runtimeMockStates,
        missingParams: [...debugMissingParams],
        debugToolsEnabled,
      },
    });

    const executableLines = sanitizeCodeForExecution(code)
      .split("\n")
      .map((raw, idx) => ({ line: idx + 1, content: raw.trim() }))
      .filter((l) => l.content.length > 0 && !l.content.startsWith("#"))
      .map((l) => l.line);
    const userBreakpoints = new Set(breakpoints);
    const activeBreakpoints = executableLines;
    const safeDelay = Math.max(0, Math.min(5000, Number(debugLineDelayMs) || 0));

    const engine = new HomeScriptEngine({
      variables: params,
      queryParams: params,
      debug: true,
      breakpoints: activeBreakpoints,
      onEvent: (event) => {
        addEvent({
          source: "engine",
          level: event.level === "error" ? "error" : event.level === "success" ? "success" : event.level === "warning" ? "warning" : "info",
          message: event.message,
          line: event.line,
          details: event.details,
        });
      },
      onCall: async (service, args) => {
        setHaStateEvents((prev) => [
          ...prev,
          {
            timestamp: new Date().toISOString(),
            action: "call",
            status: "success",
            service,
            payload: args,
            value: { success: true, local_dry_run: true },
          },
        ]);
        return { success: true, local_dry_run: true };
      },
      onGet: async (entityId) => {
        if (Object.prototype.hasOwnProperty.call(runtimeMockStates, entityId)) {
          const mocked = runtimeMockStates[entityId];
          setHaStateEvents((prev) => [
            ...prev,
            {
              timestamp: new Date().toISOString(),
              action: "get",
              status: "success",
              entityId,
              value: mocked,
            },
          ]);
          return mocked;
        }
        const entity = haEntities.find(e => e.entity_id === entityId);
        setHaStateEvents((prev) => [
          ...prev,
          {
            timestamp: new Date().toISOString(),
            action: "get",
            status: "success",
            entityId,
            value: entity ? entity.state : "unknown",
          },
        ]);
        return entity ? entity.state : "unknown";
      },
      onSet: async (entityId, state) => {
        runtimeMockStates[entityId] = state;
        const isMock = localStorage.getItem("is_mock") === "true";
        const currentHaUrl = localStorage.getItem("ha_url");
        const currentHaToken = localStorage.getItem("ha_token");

        if (isMock && currentHaUrl && currentHaToken) {
          const conn = new BrowserHAConnection({ url: currentHaUrl, token: currentHaToken });
          const domain = entityId.split('.')[0];
          let serviceDomain = 'homeassistant';
          let serviceName = '';
          let payload: any = { entity_id: entityId };

          if (state === 'on' || state === true) {
            serviceName = 'turn_on';
          } else if (state === 'off' || state === false) {
            serviceName = 'turn_off';
          } else if (domain === 'input_number') {
            serviceDomain = 'input_number';
            serviceName = 'set_value';
            payload.value = Number(state);
          } else if (domain === 'input_select') {
            serviceDomain = 'input_select';
            serviceName = 'select_option';
            payload.option = String(state);
          } else if (domain === 'input_text') {
            serviceDomain = 'input_text';
            serviceName = 'set_value';
            payload.value = String(state);
          } else if (domain === 'input_boolean') {
            serviceDomain = 'input_boolean';
            serviceName = state ? 'turn_on' : 'turn_off';
          }

          if (serviceName) {
            await conn.callService(serviceDomain, serviceName, payload);
          } else {
            await conn.setState!(entityId, String(state));
          }
          conn.disconnect();
          setHaStateEvents((prev) => [
            ...prev,
            {
              timestamp: new Date().toISOString(),
              action: "set",
              status: "success",
              entityId,
              value: state,
              payload,
            },
          ]);
          return true;
        }
        setHaStateEvents((prev) => [
          ...prev,
          {
            timestamp: new Date().toISOString(),
            action: "set",
            status: "success",
            entityId,
            value: state,
          },
        ]);
        return false;
      },
      importCallback: async (name: string) => {
        const token = localStorage.getItem("auth_token");
        const res = await fetch("/api/scripts", {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Failed to fetch scripts for import");
        const scripts = await res.json();
        const script = scripts.find((s: any) => s.endpoint === name);
        if (!script) throw new Error(`Script '${name}' not found`);
        return script.code;
      },
      onBreakpoint: async (line, vars) => {
          setCurrentLine(line);
          setVariables(vars);
          if (debugStopRequestedRef.current) return "STOP";
          if (safeDelay > 0) {
            await new Promise<void>((resolve) => {
              window.setTimeout(() => resolve(), safeDelay);
            });
          }
          if (debugStopRequestedRef.current) return "STOP";
          const shouldPause = debugPausedRef.current || userBreakpoints.has(line);
          if (!shouldPause) return "CONTINUE";
          setDebugPaused(true);
          debugPausedRef.current = true;
          return new Promise((resolve) => {
            debugResolver.current = resolve;
          });
      }
    });

    try {
      const result = await engine.execute(sanitizeCodeForExecution(code));
      setOutput(result.output);
      setVariables(result.variables);
      addEvent({
        source: "frontend",
        level: "success",
        message: "Debug execution completed",
      });
    } catch (e: any) {
      if (e.message !== "Debugger stopped") {
        setOutput([`Error: ${e.message}`]);
        addEvent({
          source: "frontend",
          level: "error",
          message: e.message,
        });
        if (e instanceof HomeScriptError) {
            setErrorMarker(e.line, e.message);
        }
      } else {
        setOutput((prev) => [...prev, "Debugger stopped by user."]);
        addEvent({
          source: "frontend",
          level: "warning",
          message: "Debugger stopped by user",
        });
      }
    } finally {
        setIsDebugging(false);
        setDebugPaused(false);
        debugPausedRef.current = false;
        setCurrentLine(null);
        debugResolver.current = null;
        debugStopRequestedRef.current = false;
    }
  };

  const handleDebugPlay = () => {
      if (!debugToolsEnabled) return;
      if (!isDebugging) {
        void handleDebug();
        return;
      }
      setDebugPaused(false);
      debugPausedRef.current = false;
      if (debugResolver.current) debugResolver.current("CONTINUE");
  };

  const handleDebugPause = () => {
      if (!debugToolsEnabled || !isDebugging) return;
      setDebugPaused(true);
      debugPausedRef.current = true;
  };

  const handleStop = () => {
      debugStopRequestedRef.current = true;
      setDebugPaused(false);
      debugPausedRef.current = false;
      if (debugResolver.current) debugResolver.current("STOP");
  };

  const handleRunLocal = async () => {
    clearMarkers();
    resetExecutionConsole();
    addEvent({
      source: "frontend",
      level: "info",
      message: "Local run started",
    });
    let params = {};
    let runtimeMockStates: Record<string, any> = {};
    try {
      const resolved = resolveRuntimeInputs(debugDataMode, true);
      params = resolved.params;
      runtimeMockStates = { ...resolved.mockStates };
      if (resolved.paramsFallback) {
        addEvent({
          source: "frontend",
          level: "warning",
          message: "Manual test params were invalid. Auto-generated params were used.",
        });
      }
      setDebugInputError(null);
    } catch (e) {
      const message = (e as any)?.message || "Invalid JSON in test parameters";
      setOutput([`Error: ${message}`]);
      setDebugInputError(message);
      setFrontendMeta({
        mode: "local",
        parseOk: false,
        runCommand: {
          mode: "local",
          params,
          parseError: message,
          debugToolsEnabled,
        },
      });
      addEvent({
        source: "frontend",
        level: "error",
        message,
      });
      return;
    }
    setFrontendMeta({
      mode: "local",
      parseOk: true,
      runCommand: {
        mode: "local",
        params,
        mockStates: runtimeMockStates,
        debugToolsEnabled,
      },
    });

    const engine = new HomeScriptEngine({
      variables: params,
      queryParams: params,
      onEvent: (event) => {
        addEvent({
          source: "engine",
          level: event.level === "error" ? "error" : event.level === "success" ? "success" : event.level === "warning" ? "warning" : "info",
          message: event.message,
          line: event.line,
          details: event.details,
        });
      },
      onCall: async (service, args) => {
        const isMock = localStorage.getItem("is_mock") === "true";
        const currentHaUrl = localStorage.getItem("ha_url");
        const currentHaToken = localStorage.getItem("ha_token");
        
        const [domain, serviceName] = service.split('.');
        let payload = {};
        if (args.length > 0) {
            if (typeof args[0] === 'object') {
                payload = args[0];
            } else if (typeof args[0] === 'string') {
                payload = { entity_id: args[0] };
            }
        }

        if (isMock && currentHaUrl && currentHaToken) {
            try {
                const conn = new BrowserHAConnection({ url: currentHaUrl, token: currentHaToken });
                const result = await conn.callService(domain, serviceName, payload);
                conn.disconnect();
                setHaStateEvents((prev) => [
                  ...prev,
                  {
                    timestamp: new Date().toISOString(),
                    action: "call",
                    status: "success",
                    service,
                    payload,
                    value: result,
                  },
                ]);
                return { success: true, ha_response: result };
            } catch (e: any) {
                setHaStateEvents((prev) => [
                  ...prev,
                  {
                    timestamp: new Date().toISOString(),
                    action: "call",
                    status: "fail",
                    service,
                    payload,
                    error: e.message,
                  },
                ]);
                return { success: false, error: e.message };
            }
        } else if (!isMock) {
            try {
                const token = localStorage.getItem("auth_token");
                const res = await fetch("/api/call_service", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ domain, service: serviceName, serviceData: payload })
                });
                const result = await res.json();
                if (!res.ok) throw new Error(result.error || "Failed to call service");
                setHaStateEvents((prev) => [
                  ...prev,
                  {
                    timestamp: new Date().toISOString(),
                    action: "call",
                    status: "success",
                    service,
                    payload,
                    value: result,
                  },
                ]);
                return { success: true, ha_response: result };
            } catch (e: any) {
                setHaStateEvents((prev) => [
                  ...prev,
                  {
                    timestamp: new Date().toISOString(),
                    action: "call",
                    status: "fail",
                    service,
                    payload,
                    error: e.message,
                  },
                ]);
                return { success: false, error: e.message };
            }
        }
        setHaStateEvents((prev) => [
          ...prev,
          {
            timestamp: new Date().toISOString(),
            action: "call",
            status: "success",
            service,
            payload,
            value: { success: true, local_dry_run: true },
          },
        ]);
        return { success: true, local_dry_run: true };
      },
      onGet: async (entityId) => {
        if (Object.prototype.hasOwnProperty.call(runtimeMockStates, entityId)) {
          const mocked = runtimeMockStates[entityId];
          setHaStateEvents((prev) => [
            ...prev,
            {
              timestamp: new Date().toISOString(),
              action: "get",
              status: "success",
              entityId,
              value: mocked,
            },
          ]);
          return mocked;
        }
        const isMock = localStorage.getItem("is_mock") === "true";
        const currentHaUrl = localStorage.getItem("ha_url");
        const currentHaToken = localStorage.getItem("ha_token");
        
        if (isMock && currentHaUrl && currentHaToken) {
            try {
                const conn = new BrowserHAConnection({ url: currentHaUrl, token: currentHaToken });
                const states = await conn.getStates();
                const entity = states.find(e => e.entity_id === entityId);
                conn.disconnect();
                setHaStateEvents((prev) => [
                  ...prev,
                  {
                    timestamp: new Date().toISOString(),
                    action: "get",
                    status: "success",
                    entityId,
                    value: entity ? entity.state : "unknown",
                  },
                ]);
                return entity ? entity.state : "unknown";
            } catch (e: any) {
                setHaStateEvents((prev) => [
                  ...prev,
                  {
                    timestamp: new Date().toISOString(),
                    action: "get",
                    status: "fail",
                    entityId,
                    error: e.message,
                  },
                ]);
                return "unknown";
            }
        } else if (!isMock) {
            try {
                const token = localStorage.getItem("auth_token");
                const res = await fetch("/api/states", {
                    headers: { "Authorization": `Bearer ${token}` }
                });
                if (res.ok) {
                    const states = await res.json();
                    const entity = states.find((e: any) => e.entity_id === entityId);
                    setHaStateEvents((prev) => [
                      ...prev,
                      {
                        timestamp: new Date().toISOString(),
                        action: "get",
                        status: "success",
                        entityId,
                        value: entity ? entity.state : "unknown",
                      },
                    ]);
                    return entity ? entity.state : "unknown";
                }
            } catch (e) {
                // Ignore and fall through
            }
        }
        const entity = haEntities.find(e => e.entity_id === entityId);
        setHaStateEvents((prev) => [
          ...prev,
          {
            timestamp: new Date().toISOString(),
            action: "get",
            status: "success",
            entityId,
            value: entity ? entity.state : "unknown",
          },
        ]);
        return entity ? entity.state : "unknown";
      },
      onSet: async (entityId, state) => {
        runtimeMockStates[entityId] = state;
        setHaStateEvents((prev) => [
          ...prev,
          {
            timestamp: new Date().toISOString(),
            action: "set",
            status: "success",
            entityId,
            value: state,
          },
        ]);
        return true;
      },
      importCallback: async (name: string) => {
        const token = localStorage.getItem("auth_token");
        // We need to fetch the script by endpoint.
        // The current API /api/scripts returns all scripts, we can filter client side or add a new endpoint.
        // For now, let's fetch all and find it.
        const res = await fetch("/api/scripts", {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Failed to fetch scripts for import");
        const scripts = await res.json();
        const script = scripts.find((s: any) => s.endpoint === name);
        if (!script) throw new Error(`Script '${name}' not found`);
        return script.code;
      }
    });

    try {
      const result = await engine.execute(sanitizeCodeForExecution(code));
      setOutput(result.output);
      setVariables(result.variables);
      addEvent({
        source: "frontend",
        level: "success",
        message: "Local run completed",
      });
    } catch (e: any) {
      setOutput([`Error: ${e.message}`]);
      addEvent({
        source: "frontend",
        level: "error",
        message: e.message,
      });
      if (e instanceof HomeScriptError) {
        setErrorMarker(e.line, e.message);
      }
    }
  };

  useEffect(() => {
    if (!debugToolsEnabled || !showDebugMenu || isDebugging || !endpoint.trim()) return;
    const token = localStorage.getItem("auth_token");
    if (!token) return;

    let cancelled = false;
    const loadLive = async () => {
      try {
        const res = await fetch(`/api/debug-access/live/${endpoint.trim()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (!data?.sessionId || data.sessionId === lastRemoteSessionIdRef.current) return;
        const createdAtMs = data?.createdAt ? Date.parse(String(data.createdAt)) : NaN;
        const enabledAtMs = debugEnabledAtRef.current;
        if (enabledAtMs && Number.isFinite(createdAtMs) && createdAtMs < enabledAtMs) return;
        lastRemoteSessionIdRef.current = data.sessionId;
        applyRemoteDebugReplay(data.payload || {}, data.createdAt || new Date().toISOString());
      } catch {
        // Ignore live replay polling failures.
      }
    };

    const timer = window.setInterval(loadLive, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [debugToolsEnabled, showDebugMenu, isDebugging, endpoint]);

  useEffect(() => {
    if (!debugToolsEnabled) {
      setDebugLiveSyncStatus("idle");
      if (debugDraftSyncTimerRef.current) {
        window.clearTimeout(debugDraftSyncTimerRef.current);
        debugDraftSyncTimerRef.current = null;
      }
      return;
    }
    if (isDebugging) return;
    if (debugDraftSyncTimerRef.current) {
      window.clearTimeout(debugDraftSyncTimerRef.current);
      debugDraftSyncTimerRef.current = null;
    }
    setDebugLiveSyncStatus("syncing");
    debugDraftSyncTimerRef.current = window.setTimeout(async () => {
      if (id) {
        try {
          const token = localStorage.getItem("auth_token");
          const res = await fetch(`/api/scripts/${id}/debug`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ debugCode: code }),
          });
          if (!res.ok) throw new Error("Failed to sync debug draft");
          setStoredDebugCode(code);
          setDebugLiveSyncStatus("synced");
        } catch {
          setDebugLiveSyncStatus("error");
        }
      } else {
        setStoredDebugCode(code);
        setDebugLiveSyncStatus("synced");
      }
    }, 650);

    return () => {
      if (debugDraftSyncTimerRef.current) {
        window.clearTimeout(debugDraftSyncTimerRef.current);
        debugDraftSyncTimerRef.current = null;
      }
    };
  }, [code, debugToolsEnabled, id, isDebugging]);

  useEffect(() => {
    if (!debugToolsEnabled) return;
    if (collapseMetaTimerRef.current) {
      window.clearTimeout(collapseMetaTimerRef.current);
      collapseMetaTimerRef.current = null;
    }
    collapseMetaTimerRef.current = window.setTimeout(() => {
      collapseMetaBlocksIfNeeded(false);
    }, 50);
    return () => {
      if (collapseMetaTimerRef.current) {
        window.clearTimeout(collapseMetaTimerRef.current);
        collapseMetaTimerRef.current = null;
      }
    };
  }, [code, debugToolsEnabled]);

  useEffect(() => {
    return () => {
      if (debugDraftSyncTimerRef.current) {
        window.clearTimeout(debugDraftSyncTimerRef.current);
        debugDraftSyncTimerRef.current = null;
      }
      if (eventEditorNoticeTimerRef.current) {
        window.clearTimeout(eventEditorNoticeTimerRef.current);
        eventEditorNoticeTimerRef.current = null;
      }
      if (collapseMetaTimerRef.current) {
        window.clearTimeout(collapseMetaTimerRef.current);
        collapseMetaTimerRef.current = null;
      }
      if (remoteReplayTimerRef.current) {
        window.clearInterval(remoteReplayTimerRef.current);
        remoteReplayTimerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-zinc-950">
      <header className="flex flex-col md:flex-row items-start md:items-center justify-between p-4 gap-4 border-b border-zinc-800 bg-zinc-900">
        <div className="flex flex-wrap items-center gap-4 w-full md:w-auto">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/scripts")}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Script Name"
              className="bg-transparent border-none text-white font-medium text-lg focus:outline-none focus:ring-0 placeholder-zinc-600 w-full sm:w-48"
            />
            <span className="text-zinc-600 hidden sm:inline">/api/run/</span>
            <input
              type="text"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="endpoint-name"
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1 text-emerald-400 font-mono text-sm focus:outline-none focus:border-emerald-500 transition-colors w-full sm:w-48"
            />
            <div className="flex items-center gap-2 bg-zinc-800 px-3 py-1.5 rounded-lg text-xs text-zinc-400 hidden lg:flex" title="Webhook URL">
              <Webhook className="w-3 h-3" />
              <span className="font-mono select-all">/api/webhook/{endpoint}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          {saveError && (
            <div className="flex items-center gap-2 text-red-400 text-sm mr-4">
              <AlertCircle className="w-4 h-4" />
              {saveError}
            </div>
          )}
          <Button
            variant="secondary"
            size="icon"
            onClick={handleSave}
            disabled={saving}
            title={saving ? "Saving..." : "Save"}
            className={savePulse ? "ring-2 ring-emerald-400/60 scale-105 transition-all" : "transition-all"}
          >
            <Save className={`w-5 h-5 ${saving ? "animate-spin" : ""}`} />
          </Button>
          {id && (
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setShowPromptGenerator(true)}
              title="Open Prompt Generator"
              className="bg-indigo-700 hover:bg-indigo-600"
            >
              <WandSparkles className="w-5 h-5" />
            </Button>
          )}
          
          <Button
            size="icon"
            className="bg-indigo-600 hover:bg-indigo-500"
            onClick={handleRunLocal}
            title="Local Run"
          >
            <Laptop className="w-5 h-5" />
          </Button>
          <Button
            size="icon"
            className={debugToolsEnabled ? "bg-orange-600 hover:bg-orange-500" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-400"}
            onClick={() => { void toggleDebugTools(); }}
            title={debugToolsEnabled ? "Disable Debug Mode" : "Enable Debug Mode"}
          >
            <Bug className="w-5 h-5" />
          </Button>
          {debugToolsEnabled ? (
            <>
              <Button
                size="icon"
                className={isDebugging ? "bg-emerald-600 hover:bg-emerald-500" : "bg-emerald-700 hover:bg-emerald-600"}
                onClick={handleDebugPlay}
                title={isDebugging ? "Resume" : "Start Debug"}
              >
                <Play className="w-5 h-5" />
              </Button>
              <Button
                size="icon"
                className={debugPaused ? "bg-amber-600 hover:bg-amber-500" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"}
                onClick={handleDebugPause}
                title="Pause"
                disabled={!isDebugging}
              >
                <Pause className="w-5 h-5" />
              </Button>
              <Button
                size="icon"
                className="bg-red-600 hover:bg-red-500"
                onClick={handleStop}
                title="Stop"
                disabled={!isDebugging}
              >
                <Square className="w-5 h-5" />
              </Button>
            </>
          ) : (
            <Button
              size="icon"
              onClick={handleRunServer}
              title="Server Run"
            >
              <Play className="w-5 h-5" />
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        <div className="flex-1 border-r-0 lg:border-r border-b lg:border-b-0 border-zinc-800 flex flex-col min-h-0 relative">
          <div className="flex-1 min-h-0">
            <Editor
              height="100%"
              defaultLanguage="homescript"
              theme="homescript-dark"
              value={code}
              onChange={(val) => handleCodeChange(val || "")}
              onMount={(editor, monaco) => {
                editorRef.current = editor;
                
                // Register Ctrl+K command
              editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
                setShowCommandPalette(true);
              });
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                void saveHandlerRef.current?.();
              });

                editor.onMouseDown((e: any) => {
                  if (!debugToolsEnabledRef.current) return;
                  if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
                    const lineNumber = e.target.position.lineNumber;
                    setBreakpoints((prev) => {
                      if (prev.includes(lineNumber)) {
                        return prev.filter((l) => l !== lineNumber);
                      } else {
                        return [...prev, lineNumber];
                      }
                    });
                  }
                });

                editor.onDidChangeHiddenAreas(() => {
                  if (!metaAutoCollapsedRef.current) return;
                  const model = editor.getModel();
                  if (!model) return;
                  const headers = getMetaHeaderLines(model.getValue());
                  if (headers.length === 0) return;
                  const hiddenAreas = editor.getHiddenAreas?.() || [];
                  const isHidden = (line: number) =>
                    hiddenAreas.some((r: any) => line >= r.startLineNumber && line <= r.endLineNumber);
                  if (headers.some((line) => !isHidden(line))) {
                    metaUserExpandedRef.current = true;
                  }
                });
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                fontFamily: "'JetBrains Mono', monospace",
                padding: { top: 16 },
                glyphMargin: true,
                scrollBeyondLastLine: false,
              }}
            />
          </div>
          {showRuleBuilder && (
            <div className="absolute inset-x-4 top-4 bottom-14 z-20 bg-zinc-950/95 border border-zinc-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
                <h3 className="text-sm font-medium text-zinc-200">Event Builder</h3>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={saveEventEditor}>
                    Save Events
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowRuleBuilder(false)}>
                    Close
                  </Button>
                </div>
              </div>
              <div className="p-4 h-[calc(100%-53px)] overflow-y-auto">
              <EventTriggerConfigurator
                value={eventEditorDraft || triggerConfig}
                onChange={setEventEditorDraft}
                entities={haEntities}
              />
              </div>
            </div>
          )}
          <div className="h-10 border-t border-zinc-800 bg-zinc-900/60 px-3 flex items-center justify-end">
            <button
              type="button"
              onClick={() => {
                if (showRuleBuilder) {
                  setShowRuleBuilder(false);
                } else {
                  openEventEditor();
                }
              }}
              className="text-xs font-mono text-zinc-300 hover:text-emerald-300 transition-colors"
            >
              {showRuleBuilder ? "Collapse Event Builder" : "Expand Event Builder"}
            </button>
          </div>
          <style>{`
            .breakpoint-glyph {
              background: #ef4444;
              border-radius: 50%;
              width: 10px !important;
              height: 10px !important;
              margin-left: 5px;
              cursor: pointer;
            }
            .current-line-highlight {
              background: rgba(234, 179, 8, 0.2);
            }
          `}</style>
        </div>

        <div className="w-full lg:w-[34rem] bg-zinc-900 flex flex-col min-h-0 h-[50vh] lg:h-auto border-t lg:border-t-0 border-zinc-800 overflow-y-auto">
          <div className="p-4 border-b border-zinc-800 shrink-0">
            {showDebugMenu && debugToolsEnabled && (
              <div className="mb-4 rounded-xl border border-orange-700/40 bg-orange-950/20 p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium text-orange-200 uppercase tracking-wider">Debug Menu</h3>
                  <span className={`text-xs font-medium ${isDebugging ? (debugPaused ? "text-amber-200" : "text-emerald-300") : "text-zinc-400"}`}>
                    {isDebugging ? (debugPaused ? "Paused" : "Running") : "Idle"}
                  </span>
                </div>
                <div className="rounded-lg border border-orange-800/50 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-300">
                  <div>
                    Live Debug Draft: edits auto-sync{ id ? " to database `debug_code`" : "" }. Use top-bar Play/Pause/Stop in Debug mode.
                  </div>
                  <div className="mt-1">
                    Save button always writes main script (non-debug) code.
                  </div>
                  <div className={`mt-1 font-medium ${
                    debugLiveSyncStatus === "error"
                      ? "text-red-300"
                      : debugLiveSyncStatus === "synced"
                        ? "text-emerald-300"
                        : "text-amber-200"
                  }`}>
                    Sync status: {debugLiveSyncStatus}
                  </div>
                  <div className={`mt-1 ${code === mainCode ? "text-emerald-300" : "text-amber-200"}`}>
                    Main script status: {code === mainCode ? "matches debug draft" : "different from debug draft"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    className={debugPromotePulse ? "ring-2 ring-emerald-400/60 transition-all" : "transition-all"}
                    onClick={() => {
                      setMainCode(code);
                      setDebugPromotePulse(true);
                      window.setTimeout(() => setDebugPromotePulse(false), 450);
                      addEvent({
                        source: "frontend",
                        level: "success",
                        message: "Promoted debug draft to main script",
                      });
                    }}
                  >
                    Promote Draft To Main
                  </Button>
                  <span className="text-xs text-zinc-400">
                    Save afterwards to persist main script version.
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-zinc-400">Line Highlight Delay (ms)</label>
                    <input
                      type="number"
                      min={0}
                      max={5000}
                      value={debugLineDelayMs}
                      onChange={(e) => setDebugLineDelayMs(Number(e.target.value) || 0)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 text-sm focus:outline-none focus:border-orange-500"
                    />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-400 mb-2">
                    Simulate missing params (removed before debug run, useful for REQUIRED tests)
                  </div>
                  <div className="max-h-24 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-2 flex flex-wrap gap-2">
                    {getKnownParamNames().length === 0 ? (
                      <span className="text-xs text-zinc-600">No parameters detected.</span>
                    ) : (
                      getKnownParamNames().map((paramName) => (
                        <button
                          key={paramName}
                          type="button"
                          onClick={() => toggleMissingParam(paramName)}
                          className={`px-2 py-1 rounded-md text-xs border transition-colors ${
                            debugMissingParams.includes(paramName)
                              ? "border-red-500/60 bg-red-500/20 text-red-200"
                              : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
                          }`}
                        >
                          {paramName}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
            <h3 className="text-sm font-medium text-zinc-400 mb-2 uppercase tracking-wider">Test Parameters (JSON)</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-zinc-400">Debug Data Mode</label>
                <select
                  value={debugDataMode}
                  onChange={(e) => setDebugDataMode(e.target.value as DebugDataMode)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 text-sm focus:outline-none focus:border-emerald-500"
                >
                  <option value="auto">Auto from script</option>
                  <option value="manual">Manual JSON</option>
                  <option value="preset">Predefined preset</option>
                  <option value="randomized">Randomized preset</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-zinc-400">Preset</label>
                <select
                  value={debugPreset}
                  onChange={(e) => setDebugPreset(e.target.value as keyof typeof DEBUG_PRESETS)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 text-sm focus:outline-none focus:border-emerald-500"
                >
                  {Object.keys(DEBUG_PRESETS).map((presetKey) => (
                    <option key={presetKey} value={presetKey}>{presetKey}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const payload =
                      debugDataMode === "randomized"
                        ? generateRandomizedDebugParams(DEBUG_PRESETS[debugPreset])
                        : DEBUG_PRESETS[debugPreset];
                    setTestParams(JSON.stringify(payload, null, 2));
                  }}
                >
                  Apply Debug Values
                </Button>
              </div>
              <div className="flex items-end">
                <Button size="sm" variant="outline" onClick={applyAutoGeneratedInputs}>
                  Auto Build Inputs
                </Button>
              </div>
            </div>
            <div className="rounded-xl overflow-hidden border border-zinc-800">
              <Editor
                language="json"
                value={testParams}
                onChange={(value) => setTestParams(value || "{}")}
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', monospace",
                  scrollBeyondLastLine: false,
                  lineNumbers: "on",
                }}
                height="170px"
                theme="homescript-dark"
              />
            </div>
            <h3 className="text-sm font-medium text-zinc-400 mt-4 mb-2 uppercase tracking-wider">Mock Device States (JSON)</h3>
            <p className="text-xs text-zinc-500 mb-2">
              Key format: entity id. Value format: mocked state returned by GET and updated by SET during local/debug runs.
            </p>
            <div className="rounded-xl overflow-hidden border border-zinc-800">
              <Editor
                language="json"
                value={mockDeviceStatesJson}
                onChange={(value) => setMockDeviceStatesJson(value || "{}")}
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', monospace",
                  scrollBeyondLastLine: false,
                  lineNumbers: "on",
                }}
                height="150px"
                theme="homescript-dark"
              />
            </div>
            {debugInputError && (
              <div className="mt-3 text-xs rounded-lg px-3 py-2 border border-red-900/70 bg-red-950/30 text-red-300">
                {debugInputError}
              </div>
            )}
          </div>
          <div className="flex-1 min-h-[20rem]">
            <ExecutionConsole
              output={output}
              variables={variables}
              events={executionEvents}
              haStates={haStateEvents}
              backendMeta={backendMeta}
              frontendMeta={frontendMeta}
              isDebugging={isDebugging}
              onContinue={handleDebugPlay}
              onStep={handleDebugPause}
              onStop={handleStop}
            />
          </div>
        </div>
      </div>
      {id && showPromptGenerator && (
        <div className="fixed inset-0 z-[140]">
          <div
            className="absolute inset-0 bg-black/65"
            onClick={() => setShowPromptGenerator(false)}
          />
          <div className="absolute inset-4 md:inset-10 lg:inset-16 bg-zinc-950 border border-indigo-900/60 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between gap-2 bg-zinc-900">
              <h3 className="text-sm font-medium text-indigo-200 uppercase tracking-wider flex items-center gap-2">
                <WandSparkles className="w-4 h-4" />
                LLM Prompt Generator
              </h3>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => { void handlePromptCopy(); }}>
                  {promptCopied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                  {promptCopied ? "Copied" : "Copy Prompt"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowPromptGenerator(false)}>
                  Close
                </Button>
              </div>
            </div>
            <div className="p-4 overflow-y-auto space-y-3">
              <div className="text-xs text-zinc-300">
                Generates a copy-ready prompt with script context, HomeScript rules, API details, and selected HA entities.
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {(Object.keys(PROMPT_MODE_LABELS) as PromptMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPromptMode(mode)}
                    className={`px-2 py-1.5 rounded-lg text-xs border transition-colors ${
                      promptMode === mode
                        ? "border-indigo-500/80 bg-indigo-500/20 text-indigo-100"
                        : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
                    }`}
                  >
                    {PROMPT_MODE_LABELS[mode]}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-zinc-400">Entities to include in prompt context</label>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        promptEntityTouchedRef.current = true;
                        setPromptSelectedEntityIds(promptReferencedEntityIds.filter((entityId) => promptEntityMap.has(entityId)));
                      }}
                    >
                      Select Referenced
                    </Button>
                  </div>
                  <input
                    type="text"
                    value={promptEntitySearch}
                    onChange={(e) => setPromptEntitySearch(e.target.value)}
                    placeholder="Search entities by id or friendly name..."
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200 text-sm focus:outline-none focus:border-indigo-500"
                  />
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 p-2 space-y-1">
                    {promptVisibleEntities.length === 0 ? (
                      <div className="text-xs text-zinc-500 px-1 py-1">No entities found.</div>
                    ) : (
                      promptVisibleEntities.map((entity) => {
                        const checked = promptSelectedEntityIds.includes(entity.entity_id);
                        return (
                          <label
                            key={entity.entity_id}
                            className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs cursor-pointer border ${
                              checked
                                ? "border-indigo-700/70 bg-indigo-900/30 text-indigo-100"
                                : "border-zinc-800 bg-zinc-900/40 text-zinc-300"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePromptEntity(entity.entity_id)}
                              className="accent-indigo-500"
                            />
                            <span className="font-mono">{entity.entity_id}</span>
                            <span className="text-zinc-500 truncate">{String(entity.attributes?.friendly_name || entity.state)}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-zinc-400">Extra user message appended to prompt</label>
                    <textarea
                      value={promptUserMessage}
                      onChange={(e) => setPromptUserMessage(e.target.value)}
                      placeholder="Describe what you want AI to create/update/optimize..."
                      className="w-full h-28 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200 text-sm resize-none focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-zinc-400">Copy-ready prompt output</label>
                  <textarea
                    value={promptGeneratedText}
                    readOnly
                    className="w-full h-[32rem] bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200 text-xs font-mono resize-none focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        entities={haEntities}
        services={haServices}
        onSelect={(snippet) => {
            if (editorRef.current) {
                const selection = editorRef.current.getSelection();
                const id = { major: 1, minor: 1 };
                const op = { identifier: id, range: selection, text: snippet, forceMoveMarkers: true };
                editorRef.current.executeEdits("my-source", [op]);
                editorRef.current.focus();
            }
        }}
      />
      {eventEditorNotice && (
        <div
          className={`fixed top-4 right-4 z-[120] rounded-xl border px-4 py-3 text-sm shadow-xl ${
            eventEditorNotice.type === "error"
              ? "border-red-700/60 bg-red-950/90 text-red-200"
              : "border-emerald-700/60 bg-emerald-950/90 text-emerald-200"
          }`}
        >
          {eventEditorNotice.message}
        </div>
      )}
      {debugToolsEnabled && <FloatingVariablesPanel variables={variables} />}
    </div>
  );
}
