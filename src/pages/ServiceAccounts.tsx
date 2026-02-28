import React, { useState, useEffect } from "react";
import { Key, Plus, Trash2, Copy, Check } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";

interface Account {
  id: string;
  name: string;
  created_at: string;
}

interface NewCredentials {
  name: string;
  serviceId: string;
  serviceSecret: string;
}

interface DebugAccessSettings {
  enabled: boolean;
  whitelist: string[];
  updatedAt: string | null;
}

export default function ServiceAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [name, setName] = useState("");
  const [newCredentials, setNewCredentials] = useState<NewCredentials | null>(null);
  const [copied, setCopied] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [debugAccess, setDebugAccess] = useState<DebugAccessSettings>({ enabled: false, whitelist: [], updatedAt: null });
  const [debugWhitelistText, setDebugWhitelistText] = useState("");
  const [debugSaveState, setDebugSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [debugSaveError, setDebugSaveError] = useState<string | null>(null);

  const fetchAccounts = async () => {
    const token = localStorage.getItem("auth_token");
    const res = await fetch("/api/service-accounts", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setAccounts(await res.json());
  };

  const fetchDebugAccess = async () => {
    const token = localStorage.getItem("auth_token");
    const res = await fetch("/api/debug-access", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = (await res.json()) as DebugAccessSettings;
    setDebugAccess(data);
    setDebugWhitelistText((data.whitelist || []).join("\n"));
  };

  useEffect(() => {
    fetchAccounts();
    fetchDebugAccess();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem("auth_token");
    const res = await fetch("/api/service-accounts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const data = await res.json();
      setNewCredentials({
        name: data.name,
        serviceId: data.serviceId || data.id,
        serviceSecret: data.serviceSecret || data.apiKey,
      });
      setName("");
      fetchAccounts();
    }
  };

  const handleDelete = async (id: string) => {
    const token = localStorage.getItem("auth_token");
    const res = await fetch(`/api/service-accounts/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setDeletingId(null);
      fetchAccounts();
    }
  };

  const copyHeaders = () => {
    if (newCredentials) {
      const headersText =
        `x-service-id: ${newCredentials.serviceId}\n` +
        `x-service-secret: ${newCredentials.serviceSecret}`;
      navigator.clipboard.writeText(headersText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSaveDebugAccess = async () => {
    setDebugSaveState("saving");
    setDebugSaveError(null);
    const token = localStorage.getItem("auth_token");
    const whitelist = debugWhitelistText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const res = await fetch("/api/debug-access", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        enabled: debugAccess.enabled,
        whitelist,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to save debug access settings" }));
      setDebugSaveState("error");
      setDebugSaveError(err.error || "Failed to save debug access settings");
      return;
    }
    const data = (await res.json()) as DebugAccessSettings;
    setDebugAccess(data);
    setDebugWhitelistText((data.whitelist || []).join("\n"));
    setDebugSaveState("saved");
    setTimeout(() => setDebugSaveState("idle"), 1500);
  };

  return (
    <div className="p-8 overflow-y-auto">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-white mb-2">Service Accounts</h1>
          <p className="text-zinc-400">Manage service credentials for external callers.</p>
        </div>
      </header>

      {newCredentials && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 p-6 rounded-2xl mb-8">
          <h2 className="text-emerald-400 font-medium mb-2 flex items-center gap-2">
            <Key className="w-5 h-5" />
            New Service Credentials Generated
          </h2>
          <p className="text-zinc-300 text-sm mb-4">
            Copy both headers now. Secret is shown only once.
          </p>

          <div className="space-y-3">
            <div className="bg-zinc-950 px-4 py-3 rounded-xl border border-zinc-800 text-emerald-300 font-mono text-sm break-all">
              <div className="text-zinc-500 mb-1">x-service-id</div>
              <div>{newCredentials.serviceId}</div>
            </div>
            <div className="bg-zinc-950 px-4 py-3 rounded-xl border border-zinc-800 text-emerald-300 font-mono text-sm break-all">
              <div className="text-zinc-500 mb-1">x-service-secret</div>
              <div>{newCredentials.serviceSecret}</div>
            </div>
            <div className="bg-zinc-950 px-4 py-3 rounded-xl border border-zinc-800 text-zinc-300 font-mono text-xs overflow-x-auto">
              {`curl -X POST "<your-url>/api/run/<endpoint>" \\\n  -H "x-service-id: ${newCredentials.serviceId}" \\\n  -H "x-service-secret: ${newCredentials.serviceSecret}" \\\n  -H "Content-Type: application/json" \\\n  -d '{}'`}
            </div>
            <Button variant="secondary" onClick={copyHeaders} className="flex items-center gap-2">
              {copied ? <Check className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
              {copied ? "Copied Headers" : "Copy Headers"}
            </Button>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setNewCredentials(null)}
            className="mt-4"
          >
            Dismiss
          </Button>
        </div>
      )}

      <div className="mb-6 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-sm text-zinc-300">
        <p className="mb-2">Use these request headers for service authentication:</p>
        <div className="font-mono text-xs text-emerald-300 bg-zinc-950 border border-zinc-800 rounded-xl p-3">
          <div>x-service-id: &lt;service_account_id&gt;</div>
          <div>x-service-secret: &lt;service_account_secret&gt;</div>
        </div>
      </div>

      <div className={`mb-6 rounded-2xl p-4 border ${debugAccess.enabled ? "bg-red-950/40 border-red-700/60" : "bg-zinc-900 border-zinc-800"}`}>
        <h2 className={`text-lg font-medium mb-2 ${debugAccess.enabled ? "text-red-300" : "text-zinc-200"}`}>
          Debug Bypass Mode
        </h2>
        <p className="text-sm text-zinc-300 mb-3">
          When enabled, <code className="bg-zinc-950 px-1 py-0.5 rounded">/api/run/*</code> can skip service secret verification only if all are true:
          service ID exists, and caller IP matches whitelist.
        </p>
        {debugAccess.enabled && (
          <div className="mb-3 rounded-xl border border-red-600/60 bg-red-500/15 px-3 py-2 text-sm text-red-200">
            ALERT: Debug bypass is ON. UI is forced into red warning mode.
          </div>
        )}
        <label className="inline-flex items-center gap-2 text-sm text-zinc-200 mb-3">
          <input
            type="checkbox"
            checked={debugAccess.enabled}
            onChange={(e) => setDebugAccess((prev) => ({ ...prev, enabled: e.target.checked }))}
            className="rounded border-zinc-700 bg-zinc-900"
          />
          Enable debug bypass auth for run endpoints
        </label>
        <div className="text-xs text-zinc-400 mb-2">Allowed client IP/CIDR (one per line)</div>
        <textarea
          value={debugWhitelistText}
          onChange={(e) => setDebugWhitelistText(e.target.value)}
          placeholder={"127.0.0.1/32\n192.168.1.0/24"}
          className="w-full min-h-28 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500"
        />
        {debugAccess.updatedAt && (
          <div className="text-xs text-zinc-500 mt-2">Last update: {new Date(debugAccess.updatedAt).toLocaleString()}</div>
        )}
        {debugSaveError && <div className="text-xs text-red-300 mt-2">{debugSaveError}</div>}
        <div className="mt-3">
          <Button onClick={handleSaveDebugAccess} disabled={debugSaveState === "saving"}>
            {debugSaveState === "saving" ? "Saving..." : debugSaveState === "saved" ? "Saved" : "Save Debug Settings"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1">
          <Card>
            <form onSubmit={handleCreate}>
              <CardHeader>
                <CardTitle>Create Account</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  label="Service Name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Node-RED, Grafana"
                  required
                />
                <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500">
                  <Plus className="w-5 h-5" />
                  Generate Credentials
                </Button>
              </CardContent>
            </form>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/50">
                  <th className="px-6 py-4 text-sm font-medium text-zinc-400">Name</th>
                  <th className="px-6 py-4 text-sm font-medium text-zinc-400">Service ID</th>
                  <th className="px-6 py-4 text-sm font-medium text-zinc-400">Created At</th>
                  <th className="px-6 py-4 text-sm font-medium text-zinc-400 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {accounts.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-zinc-500">
                      No service accounts found.
                    </td>
                  </tr>
                ) : (
                  accounts.map((acc) => (
                    <tr key={acc.id} className="hover:bg-zinc-800/50 transition-colors">
                      <td className="px-6 py-4 text-white font-medium">{acc.name}</td>
                      <td className="px-6 py-4 text-zinc-300 text-sm font-mono">{acc.id}</td>
                      <td className="px-6 py-4 text-zinc-400 text-sm">
                        {new Date(acc.created_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {deletingId === acc.id ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-sm text-red-400 mr-2">Sure?</span>
                            <Button variant="danger" size="sm" onClick={() => handleDelete(acc.id)}>
                              Yes
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setDeletingId(null)}>
                              No
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="hover:text-red-400"
                            onClick={() => setDeletingId(acc.id)}
                          >
                            <Trash2 className="w-5 h-5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
