import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Search, Activity, X } from "lucide-react";
import { HAEntity, HAServices } from "../shared/ha-api";
import { BrowserHAConnection } from "../client/ha-connection";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card, CardContent } from "../components/ui/Card";
import EntityDetailsPanel from "../components/EntityDetailsPanel";

const normalizeServices = (raw: any): HAServices => {
  if (!raw) return {};
  if (!Array.isArray(raw)) return raw as HAServices;

  const out: HAServices = {};
  raw.forEach((entry: any) => {
    if (!entry || typeof entry.domain !== "string") return;
    const serviceMap: Record<string, any> = {};
    const servicesRaw = entry.services;
    if (Array.isArray(servicesRaw)) {
      servicesRaw.forEach((name: string) => {
        if (typeof name === "string") serviceMap[name] = { name };
      });
    } else if (servicesRaw && typeof servicesRaw === "object") {
      Object.assign(serviceMap, servicesRaw);
    }
    out[entry.domain] = serviceMap;
  });

  return out;
};

export default function Entities() {
  const [entities, setEntities] = useState<HAEntity[]>([]);
  const [services, setServices] = useState<HAServices>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEntities = useCallback(async () => {
    setError(null);
    const haUrl = localStorage.getItem("ha_url");
    const haToken = localStorage.getItem("ha_token");
    const isMock = localStorage.getItem("is_mock") === "true";
    const authToken = localStorage.getItem("auth_token");

    if (isMock && haUrl && haToken) {
      const conn = new BrowserHAConnection({ url: haUrl, token: haToken });
      try {
        const states = await conn.getStates();
        setEntities(Array.isArray(states) ? states : []);
        return;
      } finally {
        conn.disconnect();
      }
    }

    if (!authToken) {
      setEntities([]);
      setError("Missing app auth token.");
      return;
    }

    const res = await fetch("/api/states", {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch entities: HTTP ${res.status}`);
    }
    const data = await res.json();
    setEntities(Array.isArray(data) ? data : []);
  }, []);

  const fetchServices = useCallback(async () => {
    const haUrl = localStorage.getItem("ha_url");
    const haToken = localStorage.getItem("ha_token");
    const isMock = localStorage.getItem("is_mock") === "true";
    const authToken = localStorage.getItem("auth_token");

    if (isMock && haUrl && haToken) {
      const conn = new BrowserHAConnection({ url: haUrl, token: haToken });
      try {
        const data = await conn.getServices();
        setServices(normalizeServices(data));
        return;
      } finally {
        conn.disconnect();
      }
    }

    if (!authToken) {
      setServices({});
      return;
    }

    const res = await fetch("/api/services", {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch services: HTTP ${res.status}`);
    }
    const data = await res.json();
    setServices(normalizeServices(data));
  }, []);

  const reloadAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([fetchEntities(), fetchServices()]);
    } catch (e: any) {
      setError(e?.message || "Failed to load Home Assistant data");
    } finally {
      setLoading(false);
    }
  }, [fetchEntities, fetchServices]);

  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);

  const runService = useCallback(async (domain: string, service: string, serviceData: Record<string, any>) => {
    const authToken = localStorage.getItem("auth_token");
    if (authToken) {
      const res = await fetch("/api/call_service", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ domain, service, serviceData }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Service call failed: HTTP ${res.status}`);
      }
      return;
    }

    const haUrl = localStorage.getItem("ha_url");
    const haToken = localStorage.getItem("ha_token");
    if (!haUrl || !haToken) {
      throw new Error("Missing Home Assistant credentials.");
    }

    const conn = new BrowserHAConnection({ url: haUrl, token: haToken });
    try {
      await conn.callService(domain, service, serviceData);
    } finally {
      conn.disconnect();
    }
  }, []);

  const domains = useMemo(() => Array.from(new Set(entities.map((e) => e.entity_id.split(".")[0]))).sort(), [entities]);

  const filteredEntities = useMemo(
    () =>
      entities.filter((e) => {
        const searchText = search.toLowerCase();
        const matchesSearch =
          e.entity_id.toLowerCase().includes(searchText) ||
          (e.attributes.friendly_name && String(e.attributes.friendly_name).toLowerCase().includes(searchText));
        const matchesDomain = selectedDomain ? e.entity_id.startsWith(`${selectedDomain}.`) : true;
        return matchesSearch && matchesDomain;
      }),
    [entities, search, selectedDomain]
  );

  const selectedEntity = useMemo(
    () => filteredEntities.find((e) => e.entity_id === selectedEntityId) || entities.find((e) => e.entity_id === selectedEntityId) || null,
    [filteredEntities, entities, selectedEntityId]
  );

  const openEntityDetails = (entityId: string) => {
    setSelectedEntityId(entityId);
    if (window.matchMedia("(max-width: 1279px)").matches) {
      setMobileDrawerOpen(true);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 text-zinc-100">
      <div className="p-6 border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-3 mb-2">
          <Box className="w-6 h-6 text-indigo-400" />
          <h1 className="text-2xl font-semibold">Entities & Devices</h1>
        </div>
        <p className="text-zinc-400">Browse entities, open details, and control available Home Assistant settings.</p>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-64 border-r border-zinc-800 bg-zinc-900/30 overflow-y-auto p-4 hidden md:block">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Domains</h2>
          <div className="space-y-1">
            <Button
              variant="ghost"
              onClick={() => setSelectedDomain(null)}
              className={`w-full justify-between px-3 py-2 rounded-lg text-sm transition-colors ${!selectedDomain ? "bg-indigo-500/10 text-indigo-400" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"}`}
            >
              All Entities
              <span className="text-xs opacity-50">{entities.length}</span>
            </Button>
            {domains.map((domain) => {
              const count = entities.filter((e) => e.entity_id.startsWith(`${domain}.`)).length;
              return (
                <Button
                  key={domain}
                  variant="ghost"
                  onClick={() => setSelectedDomain(domain)}
                  className={`w-full justify-between px-3 py-2 rounded-lg text-sm transition-colors ${selectedDomain === domain ? "bg-indigo-500/10 text-indigo-400" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"}`}
                >
                  {domain}
                  <span className="text-xs opacity-50">{count}</span>
                </Button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-zinc-800 flex gap-4 items-center">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 z-10" />
              <Input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search entities..." className="pl-9" />
            </div>
            <select
              className="md:hidden bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              value={selectedDomain || ""}
              onChange={(e) => setSelectedDomain(e.target.value || null)}
            >
              <option value="">All Domains</option>
              {domains.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <Button size="sm" variant="ghost" onClick={() => void reloadAll()}>
              Refresh
            </Button>
          </div>

          {error && (
            <div className="mx-4 mt-4 rounded-xl border border-red-900/60 bg-red-950/30 text-red-300 text-sm px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex-1 overflow-hidden flex flex-col xl:flex-row">
            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="flex items-center justify-center h-full text-zinc-500">
                  <Activity className="w-6 h-6 animate-pulse mr-2" />
                  Loading entities...
                </div>
              ) : filteredEntities.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-zinc-500">
                  <Box className="w-12 h-12 mb-4 opacity-20" />
                  <p>No entities found matching your search.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
                  {filteredEntities.map((entity) => {
                    const isUnavailable = entity.state === "unavailable" || entity.state === "unknown";
                    const selected = entity.entity_id === selectedEntityId;
                    return (
                      <Card
                        key={entity.entity_id}
                        onClick={() => openEntityDetails(entity.entity_id)}
                        className={`transition-colors cursor-pointer ${
                          selected
                            ? "border-emerald-500/60 bg-emerald-950/20"
                            : isUnavailable
                              ? "bg-zinc-900/30 border-zinc-800/50 opacity-60 hover:opacity-80"
                              : "hover:border-zinc-700"
                        }`}
                      >
                        <CardContent className="p-4">
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex-1 min-w-0 pr-4">
                              <h3 className={`font-medium truncate ${isUnavailable ? "text-zinc-500" : "text-zinc-200"}`} title={entity.attributes.friendly_name || entity.entity_id}>
                                {entity.attributes.friendly_name || entity.entity_id}
                              </h3>
                              <p className="text-xs text-zinc-500 font-mono truncate">{entity.entity_id}</p>
                            </div>
                            <div className={`px-2 py-1 bg-zinc-950 border border-zinc-800 rounded text-xs font-medium whitespace-nowrap ${isUnavailable ? "text-zinc-600" : "text-zinc-300"}`}>
                              {entity.state}
                            </div>
                          </div>

                          {Object.keys(entity.attributes).length > 0 && (
                            <div className="mt-3 pt-3 border-t border-zinc-800/50">
                              <div className="flex flex-wrap gap-2">
                                {Object.entries(entity.attributes)
                                  .filter(([k]) => !["friendly_name", "icon", "supported_features"].includes(k))
                                  .slice(0, 3)
                                  .map(([k, v]) => (
                                    <span key={k} className={`text-[10px] px-1.5 py-0.5 rounded ${isUnavailable ? "bg-zinc-900 text-zinc-600" : "bg-zinc-800 text-zinc-400"}`}>
                                      {k}: {typeof v === "object" ? "..." : String(v)}
                                    </span>
                                  ))}
                                {Object.keys(entity.attributes).length > 3 && (
                                  <span className="text-[10px] px-1.5 py-0.5 text-zinc-500">+{Object.keys(entity.attributes).length - 3} more</span>
                                )}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="hidden xl:block xl:w-[420px] border-t xl:border-t-0 xl:border-l border-zinc-800 bg-zinc-950/80">
              <EntityDetailsPanel entity={selectedEntity} services={services} onRunService={runService} onRefresh={fetchEntities} />
            </div>
          </div>
        </div>
      </div>

      <div className={`xl:hidden fixed inset-0 z-40 ${mobileDrawerOpen ? "" : "pointer-events-none"}`}>
        <button
          type="button"
          className={`absolute inset-0 bg-black/60 transition-opacity ${mobileDrawerOpen ? "opacity-100" : "opacity-0"}`}
          onClick={() => setMobileDrawerOpen(false)}
          aria-label="Close entity details"
        />
        <div
          className={`absolute left-0 top-0 h-full w-[92vw] max-w-md border-r border-zinc-800 bg-zinc-950 shadow-2xl transition-transform duration-300 ${
            mobileDrawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="h-full flex flex-col">
            <div className="p-3 border-b border-zinc-800 flex items-center justify-between">
              <div className="text-sm font-medium text-zinc-200 truncate pr-3">
                {selectedEntity?.attributes?.friendly_name || selectedEntity?.entity_id || "Entity details"}
              </div>
              <Button size="sm" variant="ghost" onClick={() => setMobileDrawerOpen(false)} className="h-8 w-8 p-0 min-w-0">
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex-1 min-h-0">
              <EntityDetailsPanel entity={selectedEntity} services={services} onRunService={runService} onRefresh={fetchEntities} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
