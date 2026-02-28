import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Server, Monitor, Activity, Radio } from "lucide-react";
import type { BackendRunMeta, ExecutionEvent, HAStateEvent } from "../shared/execution-report";
import { Button } from "./ui/Button";

type ConsoleTab = "raw" | "logs" | "state" | "ha" | "backend" | "frontend";

interface ExecutionConsoleProps {
  output: string[];
  variables: Record<string, any>;
  events: ExecutionEvent[];
  haStates: HAStateEvent[];
  backendMeta: BackendRunMeta | null;
  frontendMeta: Record<string, any> | null;
  isDebugging: boolean;
  onContinue: () => void;
  onStep: () => void;
  onStop: () => void;
}

const levelClass: Record<string, string> = {
  success: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  error: "text-red-300 border-red-500/30 bg-red-500/10",
  warning: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  info: "text-zinc-200 border-zinc-700 bg-zinc-900/70",
};

export default function ExecutionConsole({
  output,
  variables,
  events,
  haStates,
  backendMeta,
  frontendMeta,
  isDebugging,
  onContinue,
  onStep,
  onStop,
}: ExecutionConsoleProps) {
  const [tab, setTab] = useState<ConsoleTab>("raw");
  const [errorsOnly, setErrorsOnly] = useState(false);

  const filteredEvents = useMemo(() => {
    if (!errorsOnly) return events;
    return events.filter((event) => event.level === "error");
  }, [events, errorsOnly]);

  return (
    <div className="flex-1 p-4 overflow-y-auto flex flex-col">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant={tab === "raw" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("raw")}>Raw</Button>
          <Button variant={tab === "logs" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("logs")}>Logs</Button>
          <Button variant={tab === "state" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("state")}>State</Button>
          <Button variant={tab === "ha" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("ha")}>HA</Button>
          <Button variant={tab === "backend" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("backend")}>Backend</Button>
          <Button variant={tab === "frontend" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("frontend")}>Frontend</Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={errorsOnly ? "secondary" : "ghost"} size="sm" onClick={() => setErrorsOnly((v) => !v)}>
            {errorsOnly ? "Showing Errors" : "Show Errors"}
          </Button>
          {isDebugging && (
            <>
              <Button size="sm" onClick={onContinue}>Continue</Button>
              <Button size="sm" className="bg-blue-600 hover:bg-blue-500" onClick={onStep}>Step</Button>
              <Button size="sm" className="bg-red-600 hover:bg-red-500" onClick={onStop}>Stop</Button>
            </>
          )}
        </div>
      </div>

      {tab === "raw" && (
        <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl p-3 overflow-y-auto">
          <div className="font-mono text-sm text-zinc-300 space-y-1">
            {output.length === 0 ? (
              <span className="text-zinc-600">No print output.</span>
            ) : (
              output.map((line, i) => <div key={i}>{line}</div>)
            )}
          </div>
        </div>
      )}

      {tab === "logs" && (
        <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl p-3 overflow-y-auto space-y-2">
          {filteredEvents.length === 0 ? (
            <span className="text-zinc-600 text-sm">No log events.</span>
          ) : (
            filteredEvents.map((event) => (
              <div key={event.id} className={`rounded-lg border px-3 py-2 text-sm ${levelClass[event.level] || levelClass.info}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {event.level === "error" ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                    <span className="font-medium">{event.message}</span>
                    <span className="text-xs uppercase tracking-wider opacity-75">{event.source}</span>
                  </div>
                  <span className="text-xs opacity-75">{new Date(event.timestamp).toLocaleTimeString()}</span>
                </div>
                {event.line && <div className="mt-1 text-xs opacity-75">Line {event.line}</div>}
                {event.details && (
                  <pre className="mt-2 text-xs overflow-x-auto opacity-90">{JSON.stringify(event.details, null, 2)}</pre>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {tab === "state" && (
        <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl p-3 overflow-y-auto space-y-3">
          <div>
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Output
            </h3>
            <div className="font-mono text-sm text-zinc-300 space-y-1">
              {output.length === 0 ? <span className="text-zinc-600">No output.</span> : output.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          </div>
          <div>
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Variables</h3>
            <pre className="text-xs text-zinc-300 overflow-x-auto">{JSON.stringify(variables, null, 2)}</pre>
          </div>
          <div>
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Run Command (JSON)</h3>
            <pre className="text-xs text-zinc-300 overflow-x-auto">{JSON.stringify(frontendMeta?.runCommand ?? null, null, 2)}</pre>
          </div>
        </div>
      )}

      {tab === "ha" && (
        <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl p-3 overflow-y-auto space-y-2">
          {haStates.length === 0 ? (
            <span className="text-zinc-600 text-sm">No Home Assistant activity captured.</span>
          ) : (
            haStates.map((state, index) => (
              <div
                key={`${state.timestamp}-${index}`}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  state.status === "success" ? levelClass.success : levelClass.error
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Radio className="w-4 h-4" />
                    <span className="font-medium">{state.action.toUpperCase()}</span>
                    {state.service && <span className="font-mono text-xs">{state.service}</span>}
                    {state.entityId && <span className="font-mono text-xs">{state.entityId}</span>}
                  </div>
                  <span className="text-xs">{new Date(state.timestamp).toLocaleTimeString()}</span>
                </div>
                {state.value !== undefined && <div className="text-xs mt-1">value: {String(state.value)}</div>}
                {state.error && <div className="text-xs mt-1">error: {state.error}</div>}
              </div>
            ))
          )}
        </div>
      )}

      {tab === "backend" && (
        <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl p-3 overflow-y-auto">
          {!backendMeta ? (
            <span className="text-zinc-600 text-sm">No backend metadata.</span>
          ) : (
            <div className="space-y-2 text-sm text-zinc-300">
              <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                <Server className="w-4 h-4" />
                Backend Run Metadata
              </h3>
              <div>requestId: <span className="font-mono">{backendMeta.requestId}</span></div>
              <div>endpoint: <span className="font-mono">{backendMeta.endpoint}</span></div>
              <div>authMode: <span className="font-mono">{backendMeta.authMode}</span></div>
              <div>haMode: <span className="font-mono">{backendMeta.haMode}</span></div>
              <div>durationMs: <span className="font-mono">{backendMeta.durationMs}</span></div>
              <div>httpStatus: <span className="font-mono">{backendMeta.httpStatus}</span></div>
            </div>
          )}
        </div>
      )}

      {tab === "frontend" && (
        <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl p-3 overflow-y-auto">
          {!frontendMeta ? (
            <span className="text-zinc-600 text-sm">No frontend diagnostics.</span>
          ) : (
            <div className="space-y-2 text-sm text-zinc-300">
              <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                <Monitor className="w-4 h-4" />
                Frontend Diagnostics
              </h3>
              <pre className="text-xs overflow-x-auto">{JSON.stringify(frontendMeta, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
