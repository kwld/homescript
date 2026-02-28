import { useEffect, useMemo, useRef, useState, type PointerEventHandler } from "react";
import { ChevronDown, ChevronUp, Move } from "lucide-react";

type Vars = Record<string, any>;

interface FloatingVariablesPanelProps {
  variables: Vars;
}

const toValueText = (value: any) => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export default function FloatingVariablesPanel({ variables }: FloatingVariablesPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [position, setPosition] = useState({ x: 20, y: 84 });
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const previousVarsRef = useRef<Vars>({});
  const blinkTimerRef = useRef<number | null>(null);
  const [blinkKey, setBlinkKey] = useState<string | null>(null);

  const sortedEntries = useMemo(
    () => Object.entries(variables || {}).sort(([a], [b]) => a.localeCompare(b)),
    [variables],
  );

  useEffect(() => {
    const prev = previousVarsRef.current || {};
    let changedKey: string | null = null;
    for (const [key, value] of Object.entries(variables || {})) {
      if (!Object.is(prev[key], value)) {
        changedKey = key;
        break;
      }
    }
    previousVarsRef.current = { ...(variables || {}) };
    if (!changedKey) return;
    setBlinkKey(changedKey);
    if (blinkTimerRef.current) window.clearTimeout(blinkTimerRef.current);
    blinkTimerRef.current = window.setTimeout(() => setBlinkKey(null), 900);
    const row = rowRefs.current[changedKey];
    if (row) row.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [variables]);

  useEffect(() => {
    return () => {
      if (blinkTimerRef.current) window.clearTimeout(blinkTimerRef.current);
    };
  }, []);

  const onPointerDown: PointerEventHandler<HTMLDivElement> = (event) => {
    const root = containerRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove: PointerEventHandler<HTMLDivElement> = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const width = containerRef.current?.offsetWidth || 280;
    const height = containerRef.current?.offsetHeight || 220;
    const nextX = Math.max(8, Math.min(window.innerWidth - width - 8, event.clientX - drag.offsetX));
    const nextY = Math.max(8, Math.min(window.innerHeight - height - 8, event.clientY - drag.offsetY));
    setPosition({ x: nextX, y: nextY });
  };

  const onPointerUp: PointerEventHandler<HTMLDivElement> = (event) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      // no-op
    }
  };

  return (
    <div
      ref={containerRef}
      className="fixed z-[90] w-72 max-w-[90vw] rounded-xl border border-zinc-700 bg-zinc-900/95 shadow-2xl backdrop-blur-sm"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
    >
      <div
        className="flex items-center justify-between gap-2 px-3 py-2 border-b border-zinc-800 cursor-move touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-zinc-300">
          <Move className="w-3.5 h-3.5" />
          Variables
        </div>
        <button
          type="button"
          className="text-zinc-300 hover:text-white transition-colors"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Collapse variables panel" : "Expand variables panel"}
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>
      {expanded && (
        <div className="max-h-72 overflow-y-auto p-2">
          {sortedEntries.length === 0 ? (
            <div className="text-xs text-zinc-500 px-1 py-2">No variables yet.</div>
          ) : (
            <ul className="space-y-1 text-xs">
              {sortedEntries.map(([key, value]) => (
                <li
                  key={key}
                  ref={(node) => {
                    rowRefs.current[key] = node;
                  }}
                  className={`rounded-md px-2 py-1.5 border ${
                    blinkKey === key
                      ? "border-emerald-400/60 bg-emerald-500/20 animate-pulse"
                      : "border-zinc-800 bg-zinc-950/80"
                  }`}
                >
                  <div className="font-mono text-zinc-200 break-all">{key}</div>
                  <div className="text-zinc-400 break-all">{toValueText(value)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
