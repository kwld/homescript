import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Editor, { useMonaco } from "@monaco-editor/react";
import { Save, Play, ArrowLeft, Laptop, Bug, StopCircle, ArrowRight, Webhook, AlertCircle } from "lucide-react";
import { HomeScriptEngine, HomeScriptError } from "../shared/homescript";
import { BrowserHAConnection } from "../client/ha-connection";
import { HAEntity, HAServices } from "../shared/ha-api";
import { BackendRunMeta, ExecutionEvent, ExecutionReport, HAStateEvent } from "../shared/execution-report";
import { ScriptTriggerConfig, defaultTriggerConfig, normalizeScriptTriggerConfig } from "../shared/trigger-config";
import CommandPalette from "../components/CommandPalette";
import ExecutionConsole from "../components/ExecutionConsole";
import EventTriggerConfigurator from "../components/EventTriggerConfigurator";
import { Button } from "../components/ui/Button";

type DebugDataMode = "manual" | "preset" | "randomized";

const DEBUG_PRESETS: Record<string, Record<string, any>> = {
  climate: { temperature: 24, humidity: 48, illuminance: 350, motion: false },
  night_mode: { temperature: 20, humidity: 55, illuminance: 5, motion: true },
  energy_peak: { power: 3400, voltage: 232, current: 14.7, grid_price: 1.12 },
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
  const [output, setOutput] = useState<string[]>([]);
  const [variables, setVariables] = useState<Record<string, any>>({});
  const [testParams, setTestParams] = useState('{"temperature": 26}');
  const [debugDataMode, setDebugDataMode] = useState<DebugDataMode>("manual");
  const [debugPreset, setDebugPreset] = useState<keyof typeof DEBUG_PRESETS>("climate");
  const [triggerConfig, setTriggerConfig] = useState<ScriptTriggerConfig>(normalizeScriptTriggerConfig(defaultTriggerConfig));
  const [saving, setSaving] = useState(false);
  const [savePulse, setSavePulse] = useState(false);
  
  // HA Data for Autocomplete
  const [haEntities, setHaEntities] = useState<HAEntity[]>([]);
  const [haServices, setHaServices] = useState<HAServices>({});
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showRuleBuilder, setShowRuleBuilder] = useState(false);

  // Debugger State
  const [breakpoints, setBreakpoints] = useState<number[]>([]);
  const [isDebugging, setIsDebugging] = useState(false);
  const [currentLine, setCurrentLine] = useState<number | null>(null);
  const debugResolver = useRef<((action: "CONTINUE" | "STEP" | "STOP") => void) | null>(null);
  const saveHandlerRef = useRef<(() => Promise<void>) | null>(null);
  const decorationIds = useRef<string[]>([]);
  const completionProviderRef = useRef<any>(null);
  const homescriptLangRegisteredRef = useRef(false);

  const [services, setServices] = useState<any[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [executionEvents, setExecutionEvents] = useState<ExecutionEvent[]>([]);
  const [haStateEvents, setHaStateEvents] = useState<HAStateEvent[]>([]);
  const [backendMeta, setBackendMeta] = useState<BackendRunMeta | null>(null);
  const [frontendMeta, setFrontendMeta] = useState<Record<string, any> | null>(null);

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
            [/\b(IF|ELSE|END_IF|WHILE|DO|END_WHILE|SET|PRINT|GET|INTO|CALL|BREAK|CONTINUE|FUNCTION|END_FUNCTION|RETURN|IMPORT|AND|OR|NOT)\b/, "keyword"],
            [/\$[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*/, "variable"],
            [/[a-z_]+\.[a-z_]+/, "function"], // Highlight domain.service calls
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
        },
      });

      // Autocomplete
      completionProviderRef.current?.dispose?.();
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
          { token: "keyword", foreground: "C586C0", fontStyle: "bold" },
          { token: "variable", foreground: "9CDCFE" },
          { token: "function", foreground: "DCDCAA" }, // Function color
          { token: "string", foreground: "CE9178" },
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
    };
  }, [monaco, services, haServices, haEntities]);

  useEffect(() => {
    if (id) {
      const token = localStorage.getItem("auth_token");
      fetch(`/api/scripts/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then((res) => res.json())
        .then((data) => {
          setName(data.name);
          setEndpoint(data.endpoint);
          setCode(data.code);
          if (data.test_params) {
            setTestParams(data.test_params);
          }
          if (data.trigger_config) {
            try {
              const parsed = JSON.parse(data.trigger_config);
              setTriggerConfig(normalizeScriptTriggerConfig(parsed));
            } catch {
              setTriggerConfig(normalizeScriptTriggerConfig({}));
            }
          }
        });
    }
  }, [id]);

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

    if (!code.trim()) {
      setSaveError("Script code is required");
      return;
    }

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
        code,
        testParams,
        triggerConfig: JSON.stringify(triggerConfig),
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

  const parseManualParams = () => JSON.parse(testParams);

  const resolveParams = (mode: DebugDataMode) => {
    if (mode === "manual") return parseManualParams();
    const presetData = DEBUG_PRESETS[debugPreset];
    const payload = mode === "randomized" ? generateRandomizedDebugParams(presetData) : presetData;
    setTestParams(JSON.stringify(payload, null, 2));
    return payload;
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
      params = parseManualParams();
      addEvent({
        source: "frontend",
        level: "success",
        message: "Test parameters parsed",
      });
    } catch (e) {
      setOutput(["Error: Invalid JSON in test parameters"]);
      setFrontendMeta({
        mode: "server",
        parseOk: false,
        durationMs: Math.round(performance.now() - runStart),
      });
      addEvent({
        source: "frontend",
        level: "error",
        message: "Invalid JSON in test parameters",
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
    setCurrentLine(null);
    addEvent({
      source: "frontend",
      level: "info",
      message: "Debug session started",
    });
    
    let params = {};
    try {
      params = resolveParams(debugDataMode);
    } catch (e) {
      setOutput(["Error: Invalid JSON in test parameters"]);
      setIsDebugging(false);
      setFrontendMeta({ mode: "debug", parseOk: false });
      addEvent({
        source: "frontend",
        level: "error",
        message: "Invalid JSON in test parameters",
      });
      return;
    }
    setFrontendMeta({ mode: "debug", parseOk: true });

    const engine = new HomeScriptEngine({
      variables: params,
      debug: true,
      breakpoints: breakpoints,
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
          return new Promise((resolve) => {
              debugResolver.current = resolve;
          });
      }
    });

    try {
      const result = await engine.execute(code);
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
        setCurrentLine(null);
        debugResolver.current = null;
    }
  };

  const handleContinue = () => {
      if (debugResolver.current) debugResolver.current("CONTINUE");
  };

  const handleStep = () => {
      if (debugResolver.current) debugResolver.current("STEP");
  };

  const handleStop = () => {
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
    try {
      params = parseManualParams();
    } catch (e) {
      setOutput(["Error: Invalid JSON in test parameters"]);
      setFrontendMeta({ mode: "local", parseOk: false });
      addEvent({
        source: "frontend",
        level: "error",
        message: "Invalid JSON in test parameters",
      });
      return;
    }
    setFrontendMeta({ mode: "local", parseOk: true });

    const engine = new HomeScriptEngine({
      variables: params,
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
      const result = await engine.execute(code);
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

  return (
    <div className="flex flex-col h-full bg-zinc-950">
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
          
          {isDebugging ? (
            <>
              <Button
                size="icon"
                onClick={handleContinue}
                title="Continue"
              >
                <Play className="w-5 h-5" />
              </Button>
              <Button
                size="icon"
                className="bg-blue-600 hover:bg-blue-500"
                onClick={handleStep}
                title="Step"
              >
                <ArrowRight className="w-5 h-5" />
              </Button>
              <Button
                size="icon"
                className="bg-red-600 hover:bg-red-500"
                onClick={handleStop}
                title="Stop"
              >
                <StopCircle className="w-5 h-5" />
              </Button>
            </>
          ) : (
            <>
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
                className="bg-orange-600 hover:bg-orange-500"
                onClick={handleDebug}
                title="Debug"
              >
                <Bug className="w-5 h-5" />
              </Button>
              <Button
                size="icon"
                onClick={handleRunServer}
                title="Server Run"
              >
                <Play className="w-5 h-5" />
              </Button>
            </>
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
              onChange={(val) => setCode(val || "")}
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
                <Button size="sm" variant="ghost" onClick={() => setShowRuleBuilder(false)}>
                  Close
                </Button>
              </div>
              <div className="p-4 h-[calc(100%-53px)] overflow-y-auto">
              <EventTriggerConfigurator
                value={triggerConfig}
                onChange={setTriggerConfig}
                entities={haEntities}
              />
              </div>
            </div>
          )}
          <div className="h-10 border-t border-zinc-800 bg-zinc-900/60 px-3 flex items-center justify-end">
            <button
              type="button"
              onClick={() => setShowRuleBuilder((prev) => !prev)}
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

        <div className="w-full lg:w-[34rem] bg-zinc-900 flex flex-col min-h-0 h-[50vh] lg:h-auto border-t lg:border-t-0 border-zinc-800">
          <div className="p-4 border-b border-zinc-800">
            <h3 className="text-sm font-medium text-zinc-400 mb-2 uppercase tracking-wider">Test Parameters (JSON)</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-zinc-400">Debug Data Mode</label>
                <select
                  value={debugDataMode}
                  onChange={(e) => setDebugDataMode(e.target.value as DebugDataMode)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 text-sm focus:outline-none focus:border-emerald-500"
                >
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
            </div>
            <textarea
              value={testParams}
              onChange={(e) => setTestParams(e.target.value)}
              className="w-full h-32 bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-emerald-400 font-mono text-sm focus:outline-none focus:border-emerald-500 transition-colors resize-none"
            />
          </div>
          <ExecutionConsole
            output={output}
            variables={variables}
            events={executionEvents}
            haStates={haStateEvents}
            backendMeta={backendMeta}
            frontendMeta={frontendMeta}
            isDebugging={isDebugging}
            onContinue={handleContinue}
            onStep={handleStep}
            onStop={handleStop}
          />
        </div>
      </div>
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
    </div>
  );
}
