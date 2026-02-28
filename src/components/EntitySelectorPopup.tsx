import { useEffect, useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { HAEntity } from "../shared/ha-api";
import { parseHistoryApiResponse } from "../shared/history";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface EntitySelectorPopupProps {
  isOpen: boolean;
  onClose: () => void;
  entities: HAEntity[];
  value: string;
  onSelect: (entityId: string) => void;
}

type Availability = "available" | "unknown" | "unavailable";

const TYPE_ALIASES: Record<string, string[]> = {
  watt: ["w", "watt", "watts", "power"],
  energy: ["energy", "kwh", "wh", "mwh", "consumption"],
  lumen: ["lm", "lumen", "lumens", "lux", "lx", "illuminance", "light"],
  temperature: ["temperature", "temp", "c", "f", "celsius", "fahrenheit"],
  humidity: ["humidity", "moisture", "%"],
};

const getAvailability = (entity: HAEntity): Availability => {
  const state = String(entity.state || "").toLowerCase();
  if (state === "unavailable") return "unavailable";
  if (state === "unknown") return "unknown";
  return "available";
};

const supportsHistoryPreview = (entity: HAEntity) => {
  const numeric = Number(entity.state);
  if (Number.isFinite(numeric)) return true;
  return entity.state === "on" || entity.state === "off";
};

const buildSearchText = (entity: HAEntity) => {
  const attrs = entity.attributes || {};
  const parts = [
    entity.entity_id,
    entity.state,
    String(attrs.friendly_name || ""),
    String(attrs.unit_of_measurement || ""),
    String(attrs.device_class || ""),
    String(attrs.state_class || ""),
  ];
  return parts.join(" ").toLowerCase();
};

const queryMatchesTypeAliases = (query: string, haystack: string) => {
  for (const [aliasKey, aliases] of Object.entries(TYPE_ALIASES)) {
    if (query.includes(aliasKey) || aliases.some((a) => query.includes(a))) {
      if (aliases.some((a) => haystack.includes(a)) || haystack.includes(aliasKey)) {
        return true;
      }
    }
  }
  return false;
};

export default function EntitySelectorPopup({ isOpen, onClose, entities, value, onSelect }: EntitySelectorPopupProps) {
  const [search, setSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] = useState<"all" | Availability>("all");
  const [onlyHistoric, setOnlyHistoric] = useState(false);
  const [selectedId, setSelectedId] = useState(value);
  const [historyPoints, setHistoryPoints] = useState<Array<{ ts: string; value: number }>>([]);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedId(value);
  }, [isOpen, value]);

  const domains = useMemo(() => {
    const set = new Set<string>();
    entities.forEach((e) => set.add(e.entity_id.split(".")[0]));
    return Array.from(set).sort();
  }, [entities]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entities
      .filter((entity) => {
      const haystack = buildSearchText(entity);
      const domain = entity.entity_id.split(".")[0];
      if (domainFilter !== "all" && domain !== domainFilter) return false;
      const availability = getAvailability(entity);
      if (availabilityFilter !== "all" && availability !== availabilityFilter) return false;
      if (onlyHistoric && !supportsHistoryPreview(entity)) return false;
      if (!q) return true;
      if (haystack.includes(q)) return true;
      return queryMatchesTypeAliases(q, haystack);
    })
      .sort((a, b) => {
        const rank = (e: HAEntity) => {
          const availability = getAvailability(e);
          if (availability === "available") return 0;
          if (availability === "unknown") return 1;
          return 2;
        };
        const diff = rank(a) - rank(b);
        if (diff !== 0) return diff;
        return a.entity_id.localeCompare(b.entity_id);
      });
  }, [availabilityFilter, domainFilter, entities, onlyHistoric, search]);

  const selectedEntity = useMemo(
    () => entities.find((entity) => entity.entity_id === selectedId) || null,
    [entities, selectedId],
  );

  useEffect(() => {
    if (!isOpen || !selectedEntity || !supportsHistoryPreview(selectedEntity)) {
      setHistoryPoints([]);
      return;
    }
    const token = localStorage.getItem("auth_token");
    if (!token) {
      setHistoryPoints([]);
      return;
    }

    const controller = new AbortController();
    fetch(`/api/history?entityId=${encodeURIComponent(selectedEntity.entity_id)}&hours=24`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async (res) => {
        const contentType = res.headers.get("content-type");
        const text = await res.text();
        return parseHistoryApiResponse(res.status, contentType, text);
      })
      .then((payload) => {
        setHistoryPoints(payload.points.map((p) => ({ ts: p.ts, value: p.value })));
      })
      .catch(() => {
        setHistoryPoints([]);
      });

    return () => controller.abort();
  }, [isOpen, selectedEntity]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-5xl h-[78vh] bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-zinc-200">Select Entity</h3>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>

        <div className="p-4 border-b border-zinc-800 grid grid-cols-1 md:grid-cols-[1fr_180px_180px_auto] gap-2">
          <Input label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="entity, name, state" />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-300">Domain</label>
            <select
              value={domainFilter}
              onChange={(e) => setDomainFilter(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            >
              <option value="all">All</option>
              {domains.map((domain) => (
                <option key={domain} value={domain}>{domain}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-300">Availability</label>
            <select
              value={availabilityFilter}
              onChange={(e) => setAvailabilityFilter(e.target.value as "all" | Availability)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            >
              <option value="all">All</option>
              <option value="available">Available</option>
              <option value="unknown">Unknown</option>
              <option value="unavailable">Unavailable</option>
            </select>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-zinc-300 self-end pb-2">
            <input
              type="checkbox"
              checked={onlyHistoric}
              onChange={(e) => setOnlyHistoric(e.target.checked)}
              className="accent-emerald-500"
            />
            Historic only
          </label>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_340px]">
          <div className="overflow-y-auto border-r border-zinc-800">
            {filtered.map((entity) => {
              const selected = entity.entity_id === selectedId;
              const availability = getAvailability(entity);
              const isDimmed = availability !== "available";
              return (
                <button
                  key={entity.entity_id}
                  type="button"
                  onClick={() => setSelectedId(entity.entity_id)}
                  className={`w-full text-left px-4 py-3 border-b border-zinc-900 hover:bg-zinc-900/60 transition-colors ${
                    selected ? "bg-zinc-900 border-l-2 border-l-emerald-500" : ""
                  } ${isDimmed ? "opacity-70" : ""}`}
                >
                  <div className={`text-sm font-medium ${isDimmed ? "text-zinc-400" : "text-zinc-200"}`}>{entity.entity_id}</div>
                  <div className={`text-xs truncate ${isDimmed ? "text-zinc-500" : "text-zinc-400"}`}>
                    {entity.attributes?.friendly_name || "No friendly name"} | state: {entity.state}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="p-4 space-y-3">
            {!selectedEntity && <div className="text-sm text-zinc-400">Pick entity from the list.</div>}
            {selectedEntity && (
              <>
                <div>
                  <div className="text-xs text-zinc-500 uppercase tracking-wider">Selected</div>
                  <div className="text-sm text-zinc-200 font-medium break-all">{selectedEntity.entity_id}</div>
                </div>
                <div className="text-sm text-zinc-300">
                  Current State: <span className="text-emerald-300 font-medium">{selectedEntity.state}</span>
                </div>
                <div className="text-xs text-zinc-500">
                  Updated: {new Date(selectedEntity.last_updated).toLocaleString()}
                </div>
                {historyPoints.length > 0 && (
                  <div className="h-24 bg-zinc-900 border border-zinc-800 rounded-xl p-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={historyPoints}>
                        <Line dataKey="value" stroke="#10b981" dot={false} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <Button
                  onClick={() => {
                    onSelect(selectedEntity.entity_id);
                    onClose();
                  }}
                >
                  Use Selected Entity
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
