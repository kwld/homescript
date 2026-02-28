import React, { useState, useEffect } from "react";
import { Box, Search, Zap, Activity } from "lucide-react";
import { HAEntity } from "../shared/ha-api";
import { BrowserHAConnection } from "../client/ha-connection";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card, CardContent } from "../components/ui/Card";

export default function Entities() {
  const [entities, setEntities] = useState<HAEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);

  useEffect(() => {
    const fetchEntities = async () => {
      try {
        const haUrl = localStorage.getItem("ha_url");
        const haToken = localStorage.getItem("ha_token");
        const isMock = localStorage.getItem("is_mock") === "true";
        
        if (isMock && haUrl && haToken) {
          const conn = new BrowserHAConnection({ url: haUrl, token: haToken });
          const states = await conn.getStates();
          setEntities(states);
          conn.disconnect();
        } else {
          const token = localStorage.getItem("auth_token");
          const res = await fetch("/api/states", {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.ok) {
            const data = await res.json();
            setEntities(data);
          }
        }
      } catch (e) {
        console.error("Failed to fetch entities", e);
      } finally {
        setLoading(false);
      }
    };

    fetchEntities();
  }, []);

  const domains = Array.from(new Set(entities.map(e => e.entity_id.split('.')[0]))).sort();

  const filteredEntities = entities.filter(e => {
    const matchesSearch = e.entity_id.toLowerCase().includes(search.toLowerCase()) || 
                          (e.attributes.friendly_name && e.attributes.friendly_name.toLowerCase().includes(search.toLowerCase()));
    const matchesDomain = selectedDomain ? e.entity_id.startsWith(`${selectedDomain}.`) : true;
    return matchesSearch && matchesDomain;
  });

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 text-zinc-100">
      <div className="p-6 border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-3 mb-2">
          <Box className="w-6 h-6 text-indigo-400" />
          <h1 className="text-2xl font-semibold">Entities & Devices</h1>
        </div>
        <p className="text-zinc-400">Browse and monitor all entities available in your Home Assistant instance.</p>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar for Domains */}
        <div className="w-64 border-r border-zinc-800 bg-zinc-900/30 overflow-y-auto p-4 hidden md:block">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Domains</h2>
          <div className="space-y-1">
            <Button
              variant="ghost"
              onClick={() => setSelectedDomain(null)}
              className={`w-full justify-between px-3 py-2 rounded-lg text-sm transition-colors ${!selectedDomain ? 'bg-indigo-500/10 text-indigo-400' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'}`}
            >
              All Entities
              <span className="text-xs opacity-50">{entities.length}</span>
            </Button>
            {domains.map(domain => {
              const count = entities.filter(e => e.entity_id.startsWith(`${domain}.`)).length;
              return (
                <Button
                  key={domain}
                  variant="ghost"
                  onClick={() => setSelectedDomain(domain)}
                  className={`w-full justify-between px-3 py-2 rounded-lg text-sm transition-colors ${selectedDomain === domain ? 'bg-indigo-500/10 text-indigo-400' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'}`}
                >
                  {domain}
                  <span className="text-xs opacity-50">{count}</span>
                </Button>
              );
            })}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-zinc-800 flex gap-4 items-center">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 z-10" />
              <Input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search entities..."
                className="pl-9"
              />
            </div>
            {/* Mobile Domain Selector */}
            <select 
              className="md:hidden bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              value={selectedDomain || ""}
              onChange={e => setSelectedDomain(e.target.value || null)}
            >
              <option value="">All Domains</option>
              {domains.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

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
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredEntities.map(entity => {
                  const isUnavailable = entity.state === 'unavailable' || entity.state === 'unknown';
                  return (
                  <Card key={entity.entity_id} className={`transition-colors ${isUnavailable ? 'bg-zinc-900/30 border-zinc-800/50 opacity-60 hover:opacity-80' : 'hover:border-zinc-700'}`}>
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex-1 min-w-0 pr-4">
                          <h3 className={`font-medium truncate ${isUnavailable ? 'text-zinc-500' : 'text-zinc-200'}`} title={entity.attributes.friendly_name || entity.entity_id}>
                            {entity.attributes.friendly_name || entity.entity_id}
                          </h3>
                          <p className="text-xs text-zinc-500 font-mono truncate">{entity.entity_id}</p>
                        </div>
                        <div className={`px-2 py-1 bg-zinc-950 border border-zinc-800 rounded text-xs font-medium whitespace-nowrap ${isUnavailable ? 'text-zinc-600' : 'text-zinc-300'}`}>
                          {entity.state}
                        </div>
                      </div>
                      
                      {/* Optional: Show a few key attributes */}
                      {Object.keys(entity.attributes).length > 0 && (
                        <div className="mt-3 pt-3 border-t border-zinc-800/50">
                          <div className="flex flex-wrap gap-2">
                            {Object.entries(entity.attributes)
                              .filter(([k]) => !['friendly_name', 'icon', 'supported_features'].includes(k))
                              .slice(0, 3)
                              .map(([k, v]) => (
                                <span key={k} className={`text-[10px] px-1.5 py-0.5 rounded ${isUnavailable ? 'bg-zinc-900 text-zinc-600' : 'bg-zinc-800 text-zinc-400'}`}>
                                  {k}: {typeof v === 'object' ? '...' : String(v)}
                                </span>
                              ))
                            }
                            {Object.keys(entity.attributes).length > 3 && (
                              <span className="text-[10px] px-1.5 py-0.5 text-zinc-500">
                                +{Object.keys(entity.attributes).length - 3} more
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )})}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
