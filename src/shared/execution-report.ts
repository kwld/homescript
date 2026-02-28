export type ExecutionEventSource = "frontend" | "backend" | "engine" | "ha";
export type ExecutionEventLevel = "info" | "success" | "warning" | "error";

export interface ExecutionEvent {
  id: string;
  timestamp: string;
  source: ExecutionEventSource;
  level: ExecutionEventLevel;
  message: string;
  line?: number;
  details?: Record<string, any>;
}

export interface HAStateEvent {
  timestamp: string;
  action: "get" | "set" | "call";
  status: "success" | "fail";
  entityId?: string;
  service?: string;
  value?: any;
  payload?: any;
  error?: string;
}

export interface BackendRunMeta {
  requestId: string;
  endpoint: string;
  authMode: "jwt" | "service_key" | "debug_bypass" | "mock" | "unknown";
  haMode: "real" | "mock";
  durationMs: number;
  httpStatus: number;
}

export interface ExecutionError {
  message: string;
  line?: number;
}

export interface ExecutionReport {
  schemaVersion: 1;
  success: boolean;
  durationMs: number;
  output: string[];
  variables: Record<string, any>;
  events: ExecutionEvent[];
  haStates: HAStateEvent[];
  error?: ExecutionError;
  meta: BackendRunMeta;
}
