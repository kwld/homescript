import React, { useState, useEffect, useRef } from "react";
import { Search, Zap, Box, Download, Code, Copy, SlidersHorizontal } from "lucide-react";
import { HAEntity, HAServices } from "../shared/ha-api";
import { Button } from "./ui/Button";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  entities: HAEntity[];
  services: HAServices;
  onSelect: (code: string) => void;
}

type TemplateAction = {
  id: string;
  label: string;
  detail: string;
  code: string;
};

const buildServicePayloadTemplate = (entity: HAEntity, serviceName: string, serviceMeta: any) => {
  const payload: Record<string, any> = { entity_id: entity.entity_id };
  const fields = serviceMeta?.fields || serviceMeta?.service_fields || {};

  Object.entries(fields).forEach(([fieldName, fieldCfg]: [string, any]) => {
    const selector = fieldCfg?.selector || {};
    if (fieldName === "entity_id") return;

    if (fieldName === "source" && Array.isArray(entity.attributes?.source_list) && entity.attributes.source_list.length > 0) {
      payload[fieldName] = entity.attributes.source_list[0];
      return;
    }
    if (fieldName === "sound_mode" && Array.isArray(entity.attributes?.sound_mode_list) && entity.attributes.sound_mode_list.length > 0) {
      payload[fieldName] = entity.attributes.sound_mode_list[0];
      return;
    }

    if (selector?.boolean) {
      payload[fieldName] = false;
      return;
    }
    if (selector?.number) {
      const min = Number(selector.number?.min);
      payload[fieldName] = Number.isFinite(min) ? min : 0;
      return;
    }
    if (selector?.select?.options && Array.isArray(selector.select.options) && selector.select.options.length > 0) {
      const first = selector.select.options[0];
      payload[fieldName] = typeof first === "string" ? first : first?.value || first?.label || "";
      return;
    }

    if (fieldName === "volume_level") payload[fieldName] = Number(entity.attributes?.volume_level ?? 0.3);
    else if (fieldName === "seek_position") payload[fieldName] = Number(entity.attributes?.media_position ?? 0);
    else if (fieldName === "repeat") payload[fieldName] = "off";
    else if (fieldName === "shuffle") payload[fieldName] = false;
    else if (fieldName === "media_content_id") payload[fieldName] = String(entity.attributes?.media_content_id || "");
    else if (fieldName === "media_content_type") payload[fieldName] = String(entity.attributes?.media_content_type || "music");
    else payload[fieldName] = `<${fieldName}>`;
  });

  return payload;
};

const buildPropertyTemplates = (entity: HAEntity, services: HAServices): TemplateAction[] => {
  const domain = entity.entity_id.split(".")[0];
  const domainServices = services[domain] || {};
  const actions: TemplateAction[] = [];

  actions.push({
    id: "get-state",
    label: "Get Current State",
    detail: `GET ${entity.entity_id} INTO $state`,
    code: `GET ${entity.entity_id} INTO $state\nPRINT "state: $state"`,
  });

  const attrKeys = Object.keys(entity.attributes || {}).filter((k) => !["friendly_name", "supported_features", "icon"].includes(k));
  if (attrKeys.length > 0) {
    actions.push({
      id: "attrs-reference",
      label: "Show Property Reference",
      detail: `${domain} properties (${attrKeys.length})`,
      code: [
        `# ${entity.entity_id} property reference`,
        `# state: ${entity.state}`,
        ...attrKeys.slice(0, 24).map((k) => `# ${k}: ${JSON.stringify(entity.attributes[k])}`),
      ].join("\n"),
    });
  }

  Object.entries(domainServices).forEach(([serviceName, serviceMeta]: [string, any]) => {
    const payload = buildServicePayloadTemplate(entity, serviceName, serviceMeta);
    actions.push({
      id: `svc-${serviceName}`,
      label: `Set via ${domain}.${serviceName}`,
      detail: `CALL ${domain}.${serviceName}(...)`,
      code: `CALL ${domain}.${serviceName}(${JSON.stringify(payload, null, 2)})`,
    });
  });

  if (domain === "light") {
    actions.push({
      id: "light-turn-on-template",
      label: "Light: Brightness + Color",
      detail: "Template for turn_on with color controls",
      code: `CALL light.turn_on(${JSON.stringify({
        entity_id: entity.entity_id,
        brightness: Number(entity.attributes?.brightness ?? 128),
        rgb_color: [255, 255, 255],
      }, null, 2)})`,
    });
  }

  if (domain === "media_player") {
    actions.push({
      id: "media-volume-template",
      label: "Media: Volume Template",
      detail: "volume_set with current level",
      code: `CALL media_player.volume_set(${JSON.stringify({
        entity_id: entity.entity_id,
        volume_level: Number(entity.attributes?.volume_level ?? 0.3),
      }, null, 2)})`,
    });
    actions.push({
      id: "media-play-template",
      label: "Media: Play Template",
      detail: "play_media with content id/type",
      code: `CALL media_player.play_media(${JSON.stringify({
        entity_id: entity.entity_id,
        media_content_id: String(entity.attributes?.media_content_id || "<media_content_id>"),
        media_content_type: String(entity.attributes?.media_content_type || "music"),
      }, null, 2)})`,
    });
  }

  return actions;
};

export default function CommandPalette({ isOpen, onClose, entities, services, onSelect }: CommandPaletteProps) {
  const [search, setSearch] = useState("");
  const [selectedEntity, setSelectedEntity] = useState<HAEntity | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSearch("");
      setSelectedEntity(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredEntities = entities
    .filter(e => e.entity_id.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 50);

  const getDomain = (entityId: string) => entityId.split('.')[0];
  const templateActions = selectedEntity ? buildPropertyTemplates(selectedEntity, services) : [];

  const handleEntitySelect = (entity: HAEntity) => {
    setSelectedEntity(entity);
    setSearch("");
    inputRef.current?.focus();
  };

  const handleServiceSelect = (serviceName: string) => {
    if (!selectedEntity) return;
    const domain = getDomain(selectedEntity.entity_id);
    const code = `CALL ${domain}.${serviceName}("${selectedEntity.entity_id}")`;
    onSelect(code);
    onClose();
  };

  const handleGetStateSelect = () => {
    if (!selectedEntity) return;
    const code = `GET ${selectedEntity.entity_id} INTO $state`;
    onSelect(code);
    onClose();
  };

  const handleSetEntitySelect = () => {
    if (!selectedEntity) return;
    const code = `SET $entity = "${selectedEntity.entity_id}"`;
    onSelect(code);
    onClose();
  };

  const handleSetEntityStateSelect = () => {
    if (!selectedEntity) return;
    const code = `SET ${selectedEntity.entity_id} = "${selectedEntity.state}"`;
    onSelect(code);
    onClose();
  };

  const handleCopyEntity = () => {
    if (!selectedEntity) return;
    navigator.clipboard.writeText(JSON.stringify(selectedEntity, null, 2));
    onClose();
  };

  const handleTemplateSelect = (code: string) => {
    onSelect(code);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-20" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-[600px] shadow-2xl overflow-hidden flex flex-col max-h-[600px]" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-zinc-800 flex items-center gap-3">
          <Search className="w-5 h-5 text-zinc-400" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={selectedEntity ? `Search action for ${selectedEntity.entity_id}...` : "Search device..."}
            className="bg-transparent border-none text-white text-lg focus:outline-none w-full placeholder-zinc-600"
            onKeyDown={e => {
              if (e.key === 'Escape') {
                if (selectedEntity) {
                  setSelectedEntity(null);
                  setSearch("");
                } else {
                  onClose();
                }
              }
            }}
          />
        </div>
        
        <div className="overflow-y-auto flex-1 p-2">
          {!selectedEntity ? (
            // Entity List
            <div className="space-y-1">
              {filteredEntities.map(entity => {
                const isUnavailable = entity.state === 'unavailable' || entity.state === 'unknown';
                return (
                <Button
                  key={entity.entity_id}
                  variant="ghost"
                  onClick={() => handleEntitySelect(entity)}
                  className={`w-full !justify-start !text-left px-4 py-3 hover:bg-zinc-800 rounded-lg group transition-colors ${isUnavailable ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <Box className={`w-4 h-4 ${isUnavailable ? 'text-zinc-600' : 'text-zinc-500 group-hover:text-emerald-400'}`} />
                    <div className="text-left">
                      <div className={`font-medium ${isUnavailable ? 'text-zinc-500' : 'text-zinc-200'}`}>{entity.attributes.friendly_name || entity.entity_id}</div>
                      <div className="text-zinc-500 text-xs font-mono">{entity.entity_id}</div>
                      <div className={`text-zinc-500 text-xs mt-0.5 ${isUnavailable ? 'text-zinc-600' : 'text-zinc-500'}`}>
                        {entity.state}
                      </div>
                    </div>
                  </div>
                </Button>
              )})}
              {filteredEntities.length === 0 && (
                <div className="text-center py-8 text-zinc-500">No devices found</div>
              )}
            </div>
          ) : (
            // Service List for Selected Entity
            <div className="space-y-1">
              <Button
                variant="ghost"
                onClick={handleGetStateSelect}
                className="w-full !justify-start !text-left px-4 py-3 hover:bg-zinc-800 rounded-lg group transition-colors border-b border-zinc-800/50 mb-2"
              >
                <Download className="w-4 h-4 text-zinc-500 group-hover:text-emerald-400" />
                <div className="text-left">
                  <div className="text-zinc-200 font-medium">Get State</div>
                  <div className="text-zinc-500 text-xs font-mono">GET {selectedEntity.entity_id} INTO $state</div>
                </div>
              </Button>
              <Button
                variant="ghost"
                onClick={handleSetEntityStateSelect}
                className="w-full !justify-start !text-left px-4 py-3 hover:bg-zinc-800 rounded-lg group transition-colors border-b border-zinc-800/50 mb-2"
              >
                <Zap className="w-4 h-4 text-zinc-500 group-hover:text-emerald-400" />
                <div className="text-left">
                  <div className="text-zinc-200 font-medium">Set Entity State</div>
                  <div className="text-zinc-500 text-xs font-mono">SET {selectedEntity.entity_id} = "{selectedEntity.state}"</div>
                </div>
              </Button>
              <Button
                variant="ghost"
                onClick={handleSetEntitySelect}
                className="w-full !justify-start !text-left px-4 py-3 hover:bg-zinc-800 rounded-lg group transition-colors border-b border-zinc-800/50 mb-2"
              >
                <Code className="w-4 h-4 text-zinc-500 group-hover:text-emerald-400" />
                <div className="text-left">
                  <div className="text-zinc-200 font-medium">Set Entity Variable</div>
                  <div className="text-zinc-500 text-xs font-mono">SET $entity = "{selectedEntity.entity_id}"</div>
                </div>
              </Button>
              <Button
                variant="ghost"
                onClick={handleCopyEntity}
                className="w-full !justify-start !text-left px-4 py-3 hover:bg-zinc-800 rounded-lg group transition-colors border-b border-zinc-800/50 mb-2"
              >
                <Copy className="w-4 h-4 text-zinc-500 group-hover:text-emerald-400" />
                <div className="text-left">
                  <div className="text-zinc-200 font-medium">Copy Entity JSON</div>
                  <div className="text-zinc-500 text-xs font-mono">Copy full entity object to clipboard for debugging</div>
                </div>
              </Button>
              {(() => {
                const domain = getDomain(selectedEntity.entity_id);
                const domainServices = services[domain] || {};
                const serviceNames = Object.keys(domainServices).filter(s => s.toLowerCase().includes(search.toLowerCase()));
                const filteredTemplates = templateActions.filter((a) =>
                  `${a.label} ${a.detail}`.toLowerCase().includes(search.toLowerCase())
                );

                return (
                  <>
                    {filteredTemplates.length > 0 && (
                      <div className="mb-2">
                        <div className="px-2 py-1 text-[11px] uppercase tracking-wider text-zinc-500">Property Templates</div>
                        {filteredTemplates.map((action) => (
                          <Button
                            key={action.id}
                            variant="ghost"
                            onClick={() => handleTemplateSelect(action.code)}
                            className="w-full !justify-start !text-left px-4 py-3 hover:bg-zinc-800 rounded-lg group transition-colors"
                          >
                            <SlidersHorizontal className="w-4 h-4 text-zinc-500 group-hover:text-emerald-400" />
                            <div className="text-left">
                              <div className="text-zinc-200 font-medium">{action.label}</div>
                              <div className="text-zinc-500 text-xs font-mono">{action.detail}</div>
                            </div>
                          </Button>
                        ))}
                      </div>
                    )}
                    {serviceNames.map(serviceName => (
                      <Button
                        key={serviceName}
                        variant="ghost"
                        onClick={() => handleServiceSelect(serviceName)}
                        className="w-full !justify-start !text-left px-4 py-3 hover:bg-zinc-800 rounded-lg group transition-colors"
                      >
                        <Zap className="w-4 h-4 text-zinc-500 group-hover:text-yellow-400" />
                        <div className="text-left">
                          <div className="text-zinc-200 font-medium">{serviceName.replace(/_/g, ' ')}</div>
                          <div className="text-zinc-500 text-xs font-mono">{domain}.{serviceName}</div>
                        </div>
                      </Button>
                    ))}
                  </>
                );
              })()}
            </div>
          )}
        </div>
        
        <div className="p-2 border-t border-zinc-800 bg-zinc-950 text-xs text-zinc-500 flex justify-between px-4">
          <span>{selectedEntity ? "Select action" : "Select device"}</span>
          <div className="flex gap-2">
            <span className="bg-zinc-800 px-1.5 rounded">Esc</span> to {selectedEntity ? "back" : "close"}
          </div>
        </div>
      </div>
    </div>
  );
}
