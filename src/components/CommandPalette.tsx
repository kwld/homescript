import React, { useState, useEffect, useRef } from "react";
import { Search, Zap, Box, Download, Code, Copy } from "lucide-react";
import { HAEntity, HAServices } from "../shared/ha-api";
import { Button } from "./ui/Button";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  entities: HAEntity[];
  services: HAServices;
  onSelect: (code: string) => void;
}

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
                  className={`w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800 rounded-lg group transition-colors text-left ${isUnavailable ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <Box className={`w-4 h-4 ${isUnavailable ? 'text-zinc-600' : 'text-zinc-500 group-hover:text-emerald-400'}`} />
                    <div className="text-left">
                      <div className={`font-medium ${isUnavailable ? 'text-zinc-500' : 'text-zinc-200'}`}>{entity.attributes.friendly_name || entity.entity_id}</div>
                      <div className="text-zinc-500 text-xs font-mono">{entity.entity_id}</div>
                    </div>
                  </div>
                  <div className={`text-xs px-2 py-1 rounded ${isUnavailable ? 'text-zinc-600 bg-zinc-900 group-hover:bg-zinc-800' : 'text-zinc-500 bg-zinc-800 group-hover:bg-zinc-700'}`}>
                    {entity.state}
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
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800 rounded-lg group transition-colors text-left border-b border-zinc-800/50 mb-2 justify-start"
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
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800 rounded-lg group transition-colors text-left border-b border-zinc-800/50 mb-2 justify-start"
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
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800 rounded-lg group transition-colors text-left border-b border-zinc-800/50 mb-2 justify-start"
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
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800 rounded-lg group transition-colors text-left border-b border-zinc-800/50 mb-2 justify-start"
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

                return serviceNames.map(serviceName => (
                  <Button
                    key={serviceName}
                    variant="ghost"
                    onClick={() => handleServiceSelect(serviceName)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800 rounded-lg group transition-colors text-left justify-start"
                  >
                    <Zap className="w-4 h-4 text-zinc-500 group-hover:text-yellow-400" />
                    <div className="text-left">
                      <div className="text-zinc-200 font-medium">{serviceName.replace(/_/g, ' ')}</div>
                      <div className="text-zinc-500 text-xs font-mono">{domain}.{serviceName}</div>
                    </div>
                  </Button>
                ));
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
