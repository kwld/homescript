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

export default function ServiceAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<{ name: string; apiKey: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchAccounts = async () => {
    const token = localStorage.getItem("auth_token");
    const res = await fetch("/api/service-accounts", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) setAccounts(await res.json());
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem("auth_token");
    const res = await fetch("/api/service-accounts", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const data = await res.json();
      setNewKey(data);
      setName("");
      fetchAccounts();
    }
  };

  const handleDelete = async (id: string) => {
    const token = localStorage.getItem("auth_token");
    const res = await fetch(`/api/service-accounts/${id}`, { 
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      setDeletingId(null);
      fetchAccounts();
    }
  };

  const copyKey = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey.apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="p-8 overflow-y-auto">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-white mb-2">Service Accounts</h1>
          <p className="text-zinc-400">Manage API keys for external services.</p>
        </div>
      </header>

      {newKey && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 p-6 rounded-2xl mb-8">
          <h2 className="text-emerald-400 font-medium mb-2 flex items-center gap-2">
            <Key className="w-5 h-5" />
            New API Key Generated
          </h2>
          <p className="text-zinc-300 text-sm mb-4">
            Please copy this key now. You won't be able to see it again!
          </p>
          <div className="flex items-center gap-4">
            <code className="bg-zinc-950 px-4 py-3 rounded-xl border border-zinc-800 flex-1 text-emerald-300 font-mono">
              {newKey.apiKey}
            </code>
            <Button
              variant="secondary"
              onClick={copyKey}
              className="flex items-center gap-2"
            >
              {copied ? <Check className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setNewKey(null)}
            className="mt-4"
          >
            Dismiss
          </Button>
        </div>
      )}

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
                <Button
                  type="submit"
                  className="w-full bg-indigo-600 hover:bg-indigo-500"
                >
                  <Plus className="w-5 h-5" />
                  Generate Key
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
                  <th className="px-6 py-4 text-sm font-medium text-zinc-400">Created At</th>
                  <th className="px-6 py-4 text-sm font-medium text-zinc-400 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {accounts.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-6 py-8 text-center text-zinc-500">
                      No service accounts found.
                    </td>
                  </tr>
                ) : (
                  accounts.map((acc) => (
                    <tr key={acc.id} className="hover:bg-zinc-800/50 transition-colors">
                      <td className="px-6 py-4 text-white font-medium">{acc.name}</td>
                      <td className="px-6 py-4 text-zinc-400 text-sm">
                        {new Date(acc.created_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {deletingId === acc.id ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-sm text-red-400 mr-2">Sure?</span>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => handleDelete(acc.id)}
                            >
                              Yes
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeletingId(null)}
                            >
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
