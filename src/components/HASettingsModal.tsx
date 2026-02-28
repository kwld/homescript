import React, { useState } from "react";
import { CheckCircle, AlertCircle } from "lucide-react";
import { BrowserHAConnection } from "../client/ha-connection";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface HASettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function HASettingsModal({ isOpen, onClose }: HASettingsModalProps) {
  const [haUrl, setHaUrl] = useState(localStorage.getItem("ha_url") || "http://homeassistant.local:8123");
  const [haToken, setHaToken] = useState(localStorage.getItem("ha_token") || "");
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [connectionError, setConnectionError] = useState("");
  const [entityCount, setEntityCount] = useState(0);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    setConnectionStatus('testing');
    setConnectionError("");
    try {
      const conn = new BrowserHAConnection({ url: haUrl, token: haToken });
      await conn.connect();
      
      // Fetch Entities and Services
      const states = await conn.getStates();
      const services = await conn.getServices();
      
      setEntityCount(states.length);
      
      conn.disconnect();
      setConnectionStatus('success');
      
      // Save to local storage
      localStorage.setItem("ha_entities", JSON.stringify(states));
      localStorage.setItem("ha_services", JSON.stringify(services));
    } catch (e: any) {
      setConnectionStatus('error');
      setConnectionError(e.message || "Connection failed");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-96 shadow-xl">
        <h2 className="text-xl font-bold text-white mb-4">HA Connection Settings</h2>
        <div className="space-y-4">
          <Input
            label="Home Assistant URL"
            type="text"
            value={haUrl}
            onChange={(e) => {
                setHaUrl(e.target.value);
                localStorage.setItem("ha_url", e.target.value);
            }}
            placeholder="http://homeassistant.local:8123"
          />
          <Input
            label="Long-Lived Access Token"
            type="password"
            value={haToken}
            onChange={(e) => {
                setHaToken(e.target.value);
                localStorage.setItem("ha_token", e.target.value);
            }}
            placeholder="eyJhbGciOi..."
          />
          
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2">
              {connectionStatus === 'testing' && <span className="text-zinc-400 text-sm animate-pulse">Testing...</span>}
              {connectionStatus === 'success' && (
                <div className="flex items-center gap-1 text-emerald-400 text-sm">
                  <CheckCircle className="w-4 h-4" />
                  <span>Connected ({entityCount} entities)</span>
                </div>
              )}
              {connectionStatus === 'error' && (
                <div className="flex items-center gap-1 text-red-400 text-sm" title={connectionError}>
                  <AlertCircle className="w-4 h-4" />
                  <span>Failed</span>
                </div>
              )}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleTestConnection}
              disabled={connectionStatus === 'testing' || !haUrl || !haToken}
            >
              Test Connection
            </Button>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <Button
            onClick={onClose}
            className="bg-indigo-600 hover:bg-indigo-500"
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
