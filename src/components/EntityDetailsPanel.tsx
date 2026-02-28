import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal, Power, RefreshCw } from "lucide-react";
import { HAEntity, HAServices } from "../shared/ha-api";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import MediaPlayerController from "./MediaPlayerController";

type Props = {
  entity: HAEntity | null;
  services: HAServices;
  onRunService: (domain: string, service: string, serviceData: Record<string, any>) => Promise<void>;
  onRefresh: () => Promise<void>;
};

type FieldMeta = {
  name: string;
  required: boolean;
  description?: string;
  selector?: Record<string, any>;
};

const toColorHex = (rgb: [number, number, number] | null) => {
  if (!rgb) return "#ffffff";
  return `#${rgb.map((v) => Math.max(0, Math.min(255, Number(v))).toString(16).padStart(2, "0")).join("")}`;
};

const fromColorHex = (hex: string): [number, number, number] => {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return [255, 255, 255];
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
};

const normalizeFieldMeta = (fieldsRaw: any): FieldMeta[] => {
  if (!fieldsRaw || typeof fieldsRaw !== "object") return [];
  return Object.entries(fieldsRaw).map(([name, cfg]: [string, any]) => ({
    name,
    required: Boolean(cfg?.required),
    description: cfg?.description || cfg?.name || "",
    selector: cfg?.selector && typeof cfg.selector === "object" ? cfg.selector : undefined,
  }));
};

const getSelectorType = (field: FieldMeta): "boolean" | "number" | "select" | "text" => {
  const selector = field.selector || {};
  if (selector.boolean) return "boolean";
  if (selector.number) return "number";
  if (selector.select) return "select";
  return "text";
};

const coerceFieldValue = (field: FieldMeta, raw: string | boolean) => {
  const type = getSelectorType(field);
  if (type === "boolean") return Boolean(raw);
  if (type === "number") {
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : raw;
  }
  return raw;
};

export default function EntityDetailsPanel({ entity, services, onRunService, onRefresh }: Props) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [selectedService, setSelectedService] = useState("");
  const [serviceValues, setServiceValues] = useState<Record<string, string | boolean>>({});
  const [extraPayload, setExtraPayload] = useState("{}");
  const [brightness, setBrightness] = useState(128);
  const [color, setColor] = useState("#ffffff");
  const [colorTemp, setColorTemp] = useState(0);
  const [lightApplyMode, setLightApplyMode] = useState<"color" | "temperature">("color");

  const domain = entity?.entity_id.split(".")[0] || "";
  const domainServices = useMemo(() => services[domain] || {}, [services, domain]);
  const availableServiceNames = useMemo(() => Object.keys(domainServices).sort(), [domainServices]);
  const selectedServiceMeta = selectedService ? domainServices[selectedService] : null;
  const selectedServiceFields = useMemo(
    () => normalizeFieldMeta(selectedServiceMeta?.fields || selectedServiceMeta?.service_fields),
    [selectedServiceMeta]
  );

  const supportsPower = Boolean(domainServices.turn_on || domainServices.turn_off || domainServices.toggle);
  const supportsLightSettings = domain === "light" && Boolean(domainServices.turn_on);
  const isMediaPlayer = domain === "media_player";
  const supportsColor = useMemo(() => {
    if (!entity || domain !== "light") return false;
    const attrs = entity.attributes || {};
    const modes = Array.isArray(attrs.supported_color_modes) ? attrs.supported_color_modes.map((m: any) => String(m)) : [];
    if (modes.length === 0) return true;
    return modes.some((m) => ["rgb", "rgbw", "rgbww", "hs", "xy", "color_temp"].indexOf(m) === -1 ? false : m !== "color_temp");
  }, [entity, domain]);
  const supportsColorTemp = useMemo(() => {
    if (!entity || domain !== "light") return false;
    const attrs = entity.attributes || {};
    const modes = Array.isArray(attrs.supported_color_modes) ? attrs.supported_color_modes.map((m: any) => String(m)) : [];
    return (
      modes.includes("color_temp") ||
      Number.isFinite(Number(attrs.color_temp)) ||
      Number.isFinite(Number(attrs.color_temp_kelvin)) ||
      (Number.isFinite(Number(attrs.min_mireds)) && Number.isFinite(Number(attrs.max_mireds))) ||
      (Number.isFinite(Number(attrs.min_color_temp_kelvin)) && Number.isFinite(Number(attrs.max_color_temp_kelvin)))
    );
  }, [entity, domain]);

  const colorTempMeta = useMemo(() => {
    if (!entity) return null;
    const attrs = entity.attributes || {};
    const minKelvin = Number(attrs.min_color_temp_kelvin);
    const maxKelvin = Number(attrs.max_color_temp_kelvin);
    const currentKelvin = Number(attrs.color_temp_kelvin);
    if (Number.isFinite(minKelvin) && Number.isFinite(maxKelvin)) {
      return {
        unit: "K" as const,
        min: minKelvin,
        max: maxKelvin,
        current: Number.isFinite(currentKelvin) ? currentKelvin : Math.round((minKelvin + maxKelvin) / 2),
        key: "color_temp_kelvin" as const,
      };
    }

    const minMireds = Number(attrs.min_mireds);
    const maxMireds = Number(attrs.max_mireds);
    const currentMireds = Number(attrs.color_temp);
    if (Number.isFinite(minMireds) && Number.isFinite(maxMireds)) {
      return {
        unit: "mired" as const,
        min: minMireds,
        max: maxMireds,
        current: Number.isFinite(currentMireds) ? currentMireds : Math.round((minMireds + maxMireds) / 2),
        key: "color_temp" as const,
      };
    }

    return null;
  }, [entity]);

  useEffect(() => {
    if (!entity) return;
    const fallbackService = availableServiceNames[0] || "";
    setSelectedService((prev) => (prev && availableServiceNames.includes(prev) ? prev : fallbackService));
    setStatus(null);
    setServiceValues({});
    setExtraPayload("{}");
    const b = Number(entity.attributes?.brightness);
    if (Number.isFinite(b)) setBrightness(Math.max(1, Math.min(255, b)));
    const rgb = Array.isArray(entity.attributes?.rgb_color) && entity.attributes.rgb_color.length === 3
      ? ([Number(entity.attributes.rgb_color[0]), Number(entity.attributes.rgb_color[1]), Number(entity.attributes.rgb_color[2])] as [number, number, number])
      : null;
    setColor(toColorHex(rgb));
    if (colorTempMeta) {
      setColorTemp(Math.max(colorTempMeta.min, Math.min(colorTempMeta.max, Number(colorTempMeta.current))));
    } else {
      setColorTemp(0);
    }
    const currentMode = String(entity.attributes?.color_mode || "");
    if (supportsColorTemp && (currentMode === "color_temp" || currentMode === "color_temperature")) {
      setLightApplyMode("temperature");
    } else {
      setLightApplyMode("color");
    }
  }, [entity, availableServiceNames, colorTempMeta]);

  const run = async (service: string, payload: Record<string, any>) => {
    if (!entity) return;
    setRunning(true);
    setStatus(null);
    try {
      await onRunService(domain, service, payload);
      await onRefresh();
      setStatus(`Executed ${domain}.${service} successfully.`);
    } catch (e: any) {
      setStatus(e?.message || `Failed to execute ${domain}.${service}`);
    } finally {
      setRunning(false);
    }
  };

  const runPower = async (service: "turn_on" | "turn_off" | "toggle") => {
    if (!entity) return;
    await run(service, { entity_id: entity.entity_id });
  };

  const runLightApply = async () => {
    if (!entity) return;
    const payload: Record<string, any> = {
      entity_id: entity.entity_id,
      brightness,
    };
    if (lightApplyMode === "temperature" && supportsColorTemp && colorTempMeta) {
      payload[colorTempMeta.key] = colorTemp;
    } else if (supportsColor) {
      payload.rgb_color = fromColorHex(color);
    }
    await run("turn_on", payload);
  };

  const runDynamicService = async () => {
    if (!entity || !selectedService) return;
    const payload: Record<string, any> = { entity_id: entity.entity_id };
    selectedServiceFields.forEach((field) => {
      const raw = serviceValues[field.name];
      if (raw === undefined || raw === "") return;
      payload[field.name] = coerceFieldValue(field, raw);
    });
    const trimmedExtra = extraPayload.trim();
    if (trimmedExtra) {
      try {
        const parsed = JSON.parse(trimmedExtra);
        if (parsed && typeof parsed === "object") {
          Object.assign(payload, parsed);
        }
      } catch {
        setStatus("Extra JSON payload is invalid.");
        return;
      }
    }
    await run(selectedService, payload);
  };

  if (!entity) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500 text-sm px-6">
        Select an entity card to inspect details and control settings.
      </div>
    );
  }

  const isUnavailable = ["unknown", "unavailable"].includes(String(entity.state || "").toLowerCase());

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-zinc-100 truncate">{entity.attributes.friendly_name || entity.entity_id}</h3>
            <div className="text-xs text-zinc-500 font-mono break-all">{entity.entity_id}</div>
          </div>
          <span className={`text-xs px-2 py-1 rounded border ${isUnavailable ? "text-zinc-500 border-zinc-700 bg-zinc-900" : "text-emerald-300 border-emerald-900/60 bg-emerald-950/30"}`}>
            {entity.state}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-400">
          <div>
            <div className="text-zinc-500">Last changed</div>
            <div>{entity.last_changed ? new Date(entity.last_changed).toLocaleString() : "-"}</div>
          </div>
          <div>
            <div className="text-zinc-500">Last updated</div>
            <div>{entity.last_updated ? new Date(entity.last_updated).toLocaleString() : "-"}</div>
          </div>
        </div>
      </div>

      {supportsPower && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-200 mb-3">
            <Power className="w-4 h-4 text-emerald-400" />
            Power
          </div>
          <div className="flex flex-wrap gap-2">
            {domainServices.turn_on && (
              <Button size="sm" variant="secondary" disabled={running} onClick={() => runPower("turn_on")}>
                Turn On
              </Button>
            )}
            {domainServices.turn_off && (
              <Button size="sm" variant="secondary" disabled={running} onClick={() => runPower("turn_off")}>
                Turn Off
              </Button>
            )}
            {domainServices.toggle && (
              <Button size="sm" variant="outline" disabled={running} onClick={() => runPower("toggle")}>
                Toggle
              </Button>
            )}
          </div>
        </div>
      )}

      {supportsLightSettings && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
            <SlidersHorizontal className="w-4 h-4 text-indigo-400" />
            Light Settings
          </div>
          <div>
            <div className="text-xs text-zinc-400 mb-1">Brightness ({brightness})</div>
            <input
              type="range"
              min={1}
              max={255}
              step={1}
              value={brightness}
              onChange={(e) => setBrightness(Number(e.target.value))}
              className="w-full"
            />
          </div>
          {supportsColor && supportsColorTemp && colorTempMeta && (
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Mode</label>
              <select
                value={lightApplyMode}
                onChange={(e) => setLightApplyMode(e.target.value as "color" | "temperature")}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/40"
              >
                <option value="color">Color</option>
                <option value="temperature">Temperature</option>
              </select>
            </div>
          )}
          {(lightApplyMode === "color" || !supportsColorTemp || !colorTempMeta) && supportsColor && (
            <div className="flex items-center gap-3">
              <label className="text-xs text-zinc-400">Color</label>
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-14 rounded border border-zinc-700 bg-zinc-900" />
            </div>
          )}
          {(lightApplyMode === "temperature" || !supportsColor) && supportsColorTemp && colorTempMeta && (
            <div>
              <div className="text-xs text-zinc-400 mb-1">
                Temperature ({colorTemp} {colorTempMeta.unit})
              </div>
              <input
                type="range"
                min={colorTempMeta.min}
                max={colorTempMeta.max}
                step={1}
                value={colorTemp}
                onChange={(e) => setColorTemp(Number(e.target.value))}
                className="w-full"
              />
            </div>
          )}
          <Button size="sm" variant="secondary" disabled={running} onClick={runLightApply}>
            Apply Light Settings
          </Button>
        </div>
      )}

      {isMediaPlayer && (
        <MediaPlayerController
          entity={entity}
          services={services}
          running={running}
          onRun={async (service, payload = {}) => {
            await run(service, payload);
          }}
        />
      )}

      {!isMediaPlayer && availableServiceNames.length > 0 && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
          <div className="text-sm font-medium text-zinc-200">Service Controls</div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Service</label>
            <select
              value={selectedService}
              onChange={(e) => setSelectedService(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/40"
            >
              {availableServiceNames.map((name) => (
                <option key={name} value={name}>{domain}.{name}</option>
              ))}
            </select>
          </div>
          {selectedServiceFields.map((field) => {
            const fieldType = getSelectorType(field);
            const selector = field.selector || {};
            if (fieldType === "boolean") {
              return (
                <label key={field.name} className="flex items-center justify-between text-sm text-zinc-300">
                  <span>{field.name}</span>
                  <input
                    type="checkbox"
                    checked={Boolean(serviceValues[field.name])}
                    onChange={(e) => setServiceValues((prev) => ({ ...prev, [field.name]: e.target.checked }))}
                  />
                </label>
              );
            }
            if (fieldType === "select") {
              const options = Array.isArray(selector.select?.options) ? selector.select.options : [];
              return (
                <div key={field.name}>
                  <label className="text-xs text-zinc-400 block mb-1">{field.name}</label>
                  <select
                    value={String(serviceValues[field.name] || "")}
                    onChange={(e) => setServiceValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/40"
                  >
                    <option value="">Select value</option>
                    {options.map((opt: any) => {
                      const v = typeof opt === "string" ? opt : String(opt?.value || opt?.label || "");
                      const label = typeof opt === "string" ? opt : String(opt?.label || opt?.value || "");
                      return <option key={v} value={v}>{label}</option>;
                    })}
                  </select>
                </div>
              );
            }
            return (
              <Input
                key={field.name}
                label={field.name}
                type={fieldType === "number" ? "number" : "text"}
                value={String(serviceValues[field.name] ?? "")}
                onChange={(e) => setServiceValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                placeholder={field.description || (field.required ? "required" : "optional")}
              />
            );
          })}
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Extra JSON Payload (optional)</label>
            <textarea
              value={extraPayload}
              onChange={(e) => setExtraPayload(e.target.value)}
              className="w-full min-h-24 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-none focus:border-emerald-500/40"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={running || !selectedService} onClick={runDynamicService}>
              Run Service
            </Button>
            <Button size="sm" variant="ghost" disabled={running} onClick={() => onRefresh()}>
              <RefreshCw className="w-4 h-4" />
              Refresh
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="text-sm font-medium text-zinc-200 mb-2">Attributes</div>
        <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
          {Object.entries(entity.attributes || {}).map(([key, value]) => (
            <div key={key} className="text-xs border border-zinc-800 bg-zinc-900/40 rounded-lg px-2 py-1 text-zinc-300">
              <span className="text-zinc-400">{key}:</span>{" "}
              <span className="font-mono break-all">{typeof value === "object" ? JSON.stringify(value) : String(value)}</span>
            </div>
          ))}
        </div>
      </div>

      {status && (
        <div className={`text-xs rounded-lg px-3 py-2 border ${status.toLowerCase().includes("failed") || status.toLowerCase().includes("invalid") ? "border-red-900/70 bg-red-950/30 text-red-300" : "border-emerald-900/70 bg-emerald-950/30 text-emerald-300"}`}>
          {status}
        </div>
      )}
    </div>
  );
}
