import React, { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Link, useNavigate, useLocation } from "react-router-dom";
import { Home, Key, FileCode2, BookOpen, LogOut, Shield, Menu, X, Box, Settings, Bot } from "lucide-react";
import Dashboard from "./pages/Dashboard";
import ServiceAccounts from "./pages/ServiceAccounts";
import Scripts from "./pages/Scripts";
import ScriptEditor from "./pages/ScriptEditor";
import Guides from "./pages/Guides";
import Entities from "./pages/Entities";
import LLMHomeScriptGuide from "./pages/LLMHomeScriptGuide";
import SwaggerDocs from "./pages/SwaggerDocs";
import HASettingsModal from "./components/HASettingsModal";
import { Button } from "./components/ui/Button";

type DebugPublicEndpoint = {
  id: string;
  name: string;
  endpoint: string;
  source?: "main" | "debug";
  required: string[];
  optional: Array<{ name: string; defaultRaw: string | null }>;
  prebuiltInput: Record<string, any>;
};

function Layout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<{ name: string } | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [debugBypassEnabled, setDebugBypassEnabled] = useState(false);
  const [debugBypassWhitelistCount, setDebugBypassWhitelistCount] = useState(0);
  const [publicDebugEnabled, setPublicDebugEnabled] = useState(false);
  const [publicDebugEndpoints, setPublicDebugEndpoints] = useState<DebugPublicEndpoint[]>([]);
  const [loginTab, setLoginTab] = useState<"login" | "debug">("login");
  const [debugServiceId, setDebugServiceId] = useState("");
  const [debugEndpoint, setDebugEndpoint] = useState("");
  const [debugFilter, setDebugFilter] = useState("");
  const [debugFormValues, setDebugFormValues] = useState<Record<string, any>>({});
  const [debugMockStates, setDebugMockStates] = useState("{}");
  const [debugRunBusy, setDebugRunBusy] = useState(false);
  const [debugRunError, setDebugRunError] = useState<string | null>(null);
  const [debugRunResult, setDebugRunResult] = useState<any>(null);
  const [publicDebugError, setPublicDebugError] = useState<string | null>(null);
  const [debugBreakpointsText, setDebugBreakpointsText] = useState("");
  const [debugLineDelayMs, setDebugLineDelayMs] = useState(180);
  const [debugHighlightAllLines, setDebugHighlightAllLines] = useState(true);
  const location = useLocation();

  useEffect(() => {
    if (user) return;
    let cancelled = false;
    const loadPublicDebug = async () => {
      try {
        const res = await fetch("/api/debug-access/public");
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (!cancelled) {
            setPublicDebugEnabled(false);
            setPublicDebugEndpoints([]);
            setPublicDebugError(data.error || "Debug access unavailable");
          }
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setPublicDebugEnabled(Boolean(data.enabled));
        setPublicDebugEndpoints(Array.isArray(data.endpoints) ? data.endpoints : []);
        setPublicDebugError(null);
      } catch {
        if (!cancelled) {
          setPublicDebugEnabled(false);
          setPublicDebugEndpoints([]);
        }
      }
    };
    loadPublicDebug();
    const timer = window.setInterval(loadPublicDebug, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [user]);

  useEffect(() => {
    if (!publicDebugEnabled || publicDebugEndpoints.length === 0) return;
    const first = publicDebugEndpoints[0];
    const selected = publicDebugEndpoints.find((ep) => ep.endpoint === debugEndpoint);
    if (!debugEndpoint || !selected) {
      setDebugEndpoint(first.endpoint);
      setDebugFormValues({ ...(first.prebuiltInput || {}) });
      return;
    }
    // Keep user-entered values where possible, but update field set/defaults in near real-time.
    setDebugFormValues((prev) => {
      const next: Record<string, any> = { ...(selected.prebuiltInput || {}) };
      Object.keys(next).forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(prev, key)) next[key] = prev[key];
      });
      return next;
    });
  }, [publicDebugEnabled, publicDebugEndpoints, debugEndpoint]);

  const handleDebugEndpointChange = (next: string) => {
    setDebugEndpoint(next);
    const selected = publicDebugEndpoints.find((ep) => ep.endpoint === next);
    setDebugFormValues({ ...(selected?.prebuiltInput || {}) });
  };

  const filteredDebugEndpoints = publicDebugEndpoints.filter((ep) => {
    const q = debugFilter.trim().toLowerCase();
    if (!q) return true;
    return ep.name.toLowerCase().includes(q) || ep.endpoint.toLowerCase().includes(q);
  });

  const selectedDebugEndpoint = publicDebugEndpoints.find((ep) => ep.endpoint === debugEndpoint) || null;

  const setDebugField = (key: string, value: any) => {
    setDebugFormValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleRunPublicDebug = async () => {
    setDebugRunBusy(true);
    setDebugRunError(null);
    setDebugRunResult(null);
    let inputs: any = {};
    let mockStates: any = {};
    try {
      inputs = { ...debugFormValues };
      mockStates = JSON.parse(debugMockStates || "{}");
      if (!mockStates || typeof mockStates !== "object" || Array.isArray(mockStates)) {
        throw new Error("Mock states must be a JSON object");
      }
    } catch (e: any) {
      setDebugRunBusy(false);
      setDebugRunError(e?.message || "Invalid debug input");
      return;
    }
    const selected = publicDebugEndpoints.find((ep) => ep.endpoint === debugEndpoint);
    if (!selected) {
      setDebugRunBusy(false);
      setDebugRunError("Select an endpoint");
      return;
    }

    try {
      const breakpoints = debugBreakpointsText
        .split(/[,\s]+/)
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v > 0);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (debugServiceId.trim()) {
        headers["x-service-id"] = debugServiceId.trim();
      }
      const res = await fetch(`/api/debug-access/run/${selected.endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          inputs,
          mockStates,
          debugOptions: {
            breakpoints,
            lineDelayMs: debugLineDelayMs,
            highlightAllLines: debugHighlightAllLines,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDebugRunError(data.error || `Run failed with ${res.status}`);
        setDebugRunResult(data);
      } else {
        setDebugRunResult(data);
      }
    } catch (e: any) {
      setDebugRunError(e?.message || "Run failed");
    } finally {
      setDebugRunBusy(false);
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      try {
        const token = localStorage.getItem("auth_token");
        if (token) {
          const res = await fetch("/api/auth/me", {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.ok) {
            const data = await res.json();
            if (data.name) {
              setUser(data);
              setIsInitializing(false);
              return;
            }
          }
        }

        // If no valid token, check if mock is enabled
        const configRes = await fetch("/api/config");
        if (configRes.ok) {
          const config = await configRes.json();
          localStorage.setItem("is_mock", config.mock ? "true" : "false");
          if (config.mock) {
            localStorage.setItem("auth_token", "mock-admin-token");
            setUser({ name: "Administrator" });
          }
        }
      } catch (e) {
        console.error("Auth initialization failed", e);
      } finally {
        setIsInitializing(false);
      }
    };

    initAuth();
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location]);

  const handleLogin = async () => {
    try {
      const response = await fetch(`/api/auth/url`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to get auth URL');
      }
      const { url } = await response.json();

      const authWindow = window.open(
        url,
        'oauth_popup',
        'width=600,height=700'
      );

      if (!authWindow) {
        setLoginError('Please allow popups for this site to connect your account.');
      }
    } catch (error: any) {
      console.error('OAuth error:', error);
      setLoginError(`Login failed: ${error.message}`);
    }
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Validate origin is from AI Studio preview, localhost, or local network
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost') && !origin.includes('.local')) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        localStorage.setItem("auth_token", event.data.token);
        setUser(event.data.user);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("auth_token");
    setUser(null);
    setDebugBypassEnabled(false);
    setDebugBypassWhitelistCount(0);
  };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const loadStatus = async () => {
      try {
        const token = localStorage.getItem("auth_token");
        const res = await fetch("/api/debug-access/status", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setDebugBypassEnabled(Boolean(data.enabled));
        setDebugBypassWhitelistCount(Number(data.whitelistCount || 0));
      } catch {
        // Ignore status polling failures.
      }
    };
    loadStatus();
    const timer = window.setInterval(loadStatus, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [user]);

  if (isInitializing) {
    return (
      <div className="min-h-screen min-h-[100dvh] bg-zinc-950 flex items-center justify-center text-zinc-100">
        <div className="animate-pulse flex flex-col items-center">
          <Shield className="w-12 h-12 text-indigo-500 mb-4 opacity-50" />
          <div className="text-zinc-500 font-medium">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen min-h-[100dvh] bg-zinc-950 flex items-center justify-center text-zinc-100 p-4">
        <div className={`bg-zinc-900 p-6 sm:p-8 rounded-2xl border border-zinc-800 w-full ${loginTab === "debug" ? "max-w-2xl" : "max-w-md"} text-center`}>
          <div className="mb-6 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLoginTab("login")}
              className={`px-3 py-1.5 rounded-lg text-sm ${loginTab === "login" ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-300"}`}
            >
              Login
            </button>
            {publicDebugEnabled && (
              <button
                type="button"
                onClick={() => setLoginTab("debug")}
                className={`px-3 py-1.5 rounded-lg text-sm ${loginTab === "debug" ? "bg-red-700 text-white" : "bg-zinc-800 text-zinc-300"}`}
              >
                Debug
              </button>
            )}
          </div>
          {loginTab === "login" && (
            <>
          <Shield className="w-16 h-16 mx-auto mb-6 text-indigo-500" />
          <h1 className="text-2xl font-semibold mb-2">Home Assistant Service</h1>
          <p className="text-zinc-400 mb-8">Login via Authentik SSO to manage your services and scripts.</p>
          
          {loginError && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
              {loginError}
            </div>
          )}

          <Button
            onClick={handleLogin}
            className="w-full bg-indigo-600 hover:bg-indigo-500"
          >
            Login with Authentik
          </Button>
            </>
          )}
          {loginTab === "debug" && publicDebugEnabled && (
            <div className="text-left">
              <h1 className="text-xl font-semibold text-red-200 mb-2">Debug Endpoints</h1>
              <p className="text-zinc-400 text-sm mb-4">
                Quick LAN debug runner using whitelisted IP. Service ID is optional in this mode.
              </p>
              {publicDebugError && <div className="mb-3 text-sm text-red-300">{publicDebugError}</div>}
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Service ID (optional)</label>
                  <input
                    value={debugServiceId}
                    onChange={(e) => setDebugServiceId(e.target.value)}
                    placeholder="service account id (optional)"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Filter endpoints</label>
                  <input
                    value={debugFilter}
                    onChange={(e) => setDebugFilter(e.target.value)}
                    placeholder="Search by name or endpoint"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Endpoints</label>
                  <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto">
                    {filteredDebugEndpoints.map((ep) => (
                      <button
                        key={ep.id}
                        type="button"
                        onClick={() => handleDebugEndpointChange(ep.endpoint)}
                        className={`text-left rounded-xl border px-3 py-2 ${
                          debugEndpoint === ep.endpoint
                            ? "border-red-500/70 bg-red-500/20 text-red-100"
                            : "border-zinc-800 bg-zinc-950 text-zinc-200"
                        }`}
                      >
                        <div className="text-sm font-medium">{ep.name}</div>
                        <div className="text-xs text-zinc-400 font-mono">{ep.endpoint}</div>
                        <div className={`text-[11px] mt-1 ${ep.source === "debug" ? "text-amber-300" : "text-zinc-500"}`}>
                          source: {ep.source === "debug" ? "debug draft" : "main"}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                {selectedDebugEndpoint && (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                    <div className="text-xs text-zinc-400 mb-2">Input form (from REQUIRED/OPTIONAL)</div>
                    <div className="space-y-2">
                      {selectedDebugEndpoint.required.map((name) => (
                        <div key={`req-${name}`}>
                          <label className="text-xs text-red-200 mb-1 block">REQUIRED: {name}</label>
                          <input
                            value={String(debugFormValues[name] ?? "")}
                            onChange={(e) => setDebugField(name, e.target.value)}
                            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                          />
                        </div>
                      ))}
                      {selectedDebugEndpoint.optional.map((opt) => {
                        const currentValue = debugFormValues[opt.name];
                        const isBool = typeof currentValue === "boolean";
                        const isNum = typeof currentValue === "number";
                        return (
                          <div key={`opt-${opt.name}`}>
                            <label className="text-xs text-emerald-200 mb-1 block">
                              OPTIONAL: {opt.name}
                              {opt.defaultRaw ? <span className="text-zinc-500 ml-1">default: {opt.defaultRaw}</span> : null}
                            </label>
                            {isBool ? (
                              <select
                                value={currentValue ? "true" : "false"}
                                onChange={(e) => setDebugField(opt.name, e.target.value === "true")}
                                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                              >
                                <option value="true">true</option>
                                <option value="false">false</option>
                              </select>
                            ) : (
                              <input
                                type={isNum ? "number" : "text"}
                                value={currentValue === null || currentValue === undefined ? "" : String(currentValue)}
                                onChange={(e) => setDebugField(opt.name, isNum ? Number(e.target.value) : e.target.value)}
                                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Mock Device States (JSON)</label>
                  <textarea
                    value={debugMockStates}
                    onChange={(e) => setDebugMockStates(e.target.value)}
                    className="w-full min-h-24 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono"
                  />
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                  <div className="text-xs text-zinc-400 mb-2">Debug Execution Options</div>
                  <div className="space-y-2">
                    <label className="inline-flex items-center gap-2 text-sm text-zinc-300">
                      <input
                        type="checkbox"
                        checked={debugHighlightAllLines}
                        onChange={(e) => setDebugHighlightAllLines(e.target.checked)}
                        className="rounded border-zinc-700 bg-zinc-900"
                      />
                      Highlight all executed lines
                    </label>
                    <div>
                      <label className="text-xs text-zinc-400 mb-1 block">Breakpoints (comma-separated line numbers)</label>
                      <input
                        value={debugBreakpointsText}
                        onChange={(e) => setDebugBreakpointsText(e.target.value)}
                        placeholder="3, 8, 15"
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-400 mb-1 block">Line Delay (ms)</label>
                      <input
                        type="number"
                        min={0}
                        max={5000}
                        value={debugLineDelayMs}
                        onChange={(e) => setDebugLineDelayMs(Number(e.target.value) || 0)}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                </div>
                {debugRunError && <div className="text-sm text-red-300">{debugRunError}</div>}
                <Button
                  onClick={handleRunPublicDebug}
                  className="w-full bg-red-700 hover:bg-red-600"
                  disabled={debugRunBusy || !debugEndpoint}
                >
                  {debugRunBusy ? "Running..." : "Run Debug Endpoint"}
                </Button>
                {debugRunResult && (
                  <pre className="text-xs bg-zinc-950 border border-zinc-800 rounded-lg p-3 overflow-x-auto">{JSON.stringify(debugRunResult, null, 2)}</pre>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen min-h-[100dvh] text-zinc-100 flex flex-col md:flex-row ${debugBypassEnabled ? "bg-red-950" : "bg-zinc-950"}`}>
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900">
        <div className="flex items-center gap-2">
          <Shield className="text-indigo-500 w-6 h-6" />
          <span className="font-semibold">HA Service</span>
        </div>
        <Button 
          variant="ghost"
          size="icon"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        >
          {isMobileMenuOpen ? <X /> : <Menu />}
        </Button>
      </div>

      {/* Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-zinc-900 border-r border-zinc-800 flex flex-col
        transform transition-transform duration-200 ease-in-out
        md:relative md:translate-x-0
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-6 border-b border-zinc-800 hidden md:block">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Shield className="text-indigo-500" />
            HA Service
          </h1>
        </div>
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <Link to="/" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-zinc-800 transition-colors">
            <Home className="w-5 h-5 text-zinc-400" />
            Dashboard
          </Link>
          <Link to="/accounts" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-zinc-800 transition-colors">
            <Key className="w-5 h-5 text-zinc-400" />
            Service Accounts
          </Link>
          <Link to="/scripts" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-zinc-800 transition-colors">
            <FileCode2 className="w-5 h-5 text-zinc-400" />
            HomeScripts
          </Link>
          <Link to="/swagger" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-zinc-800 transition-colors">
            <FileCode2 className="w-5 h-5 text-zinc-400" />
            HomeScripts API
          </Link>
          <Link to="/entities" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-zinc-800 transition-colors">
            <Box className="w-5 h-5 text-zinc-400" />
            Entities & Devices
          </Link>
          <Link to="/guides" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-zinc-800 transition-colors">
            <BookOpen className="w-5 h-5 text-zinc-400" />
            Setup Guides
          </Link>
          <Link to="/guides/llm-homescript" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-zinc-800 transition-colors">
            <Bot className="w-5 h-5 text-zinc-400" />
            LLM HomeScript Guide
          </Link>
        </nav>
        <div className="p-4 border-t border-zinc-800">
          <div className="flex items-center justify-between px-4 py-3 bg-zinc-950 rounded-xl border border-zinc-800">
            <span className="text-sm font-medium truncate max-w-[120px]">{user.name}</span>
            <div className="flex items-center gap-2">
              {localStorage.getItem("is_mock") === "true" && (
                <Button variant="ghost" size="icon" onClick={() => setShowSettings(true)}>
                  <Settings className="w-5 h-5" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="hover:text-red-400" onClick={handleLogout}>
                <LogOut className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`flex-1 flex flex-col overflow-y-auto overflow-x-hidden h-[calc(100dvh-65px)] md:h-[100dvh] ${debugBypassEnabled ? "border-l border-red-800/70" : ""}`}>
        {debugBypassEnabled && (
          <div className="sticky top-0 z-30 px-4 py-3 border-b border-red-700/80 bg-red-900/90 text-red-100 text-sm">
            ALERT: Debug bypass mode is ENABLED. Run endpoints can skip service secret check from whitelisted IP/CIDR with valid `x-service-id`.
            <span className="ml-2 text-red-200/90">Whitelist entries: {debugBypassWhitelistCount}</span>
          </div>
        )}
        {children}
      </main>
      <HASettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/accounts" element={<ServiceAccounts />} />
          <Route path="/scripts" element={<Scripts />} />
          <Route path="/scripts/new" element={<ScriptEditor />} />
          <Route path="/scripts/:id" element={<ScriptEditor />} />
          <Route path="/entities" element={<Entities />} />
          <Route path="/guides" element={<Guides />} />
          <Route path="/guides/llm-homescript" element={<LLMHomeScriptGuide />} />
          <Route path="/swagger" element={<SwaggerDocs />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
