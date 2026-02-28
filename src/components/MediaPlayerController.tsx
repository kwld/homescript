import { useEffect, useMemo, useRef, useState } from "react";
import { Speaker, Volume2, ListMusic, Repeat, Shuffle, Search, Music } from "lucide-react";
import { HAEntity, HAServices } from "../shared/ha-api";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

type Props = {
  entity: HAEntity;
  services: HAServices;
  running: boolean;
  onRun: (service: string, payload?: Record<string, any>) => Promise<void>;
};

const toArray = (value: unknown): string[] => (Array.isArray(value) ? value.map((v) => String(v)) : []);

export default function MediaPlayerController({ entity, services, running, onRun }: Props) {
  const unifiedButtonClass = "h-9 w-full justify-center";
  const domainServices = useMemo(() => services.media_player || {}, [services]);
  const hasService = (name: string) => Boolean(domainServices[name]);

  const [volumePercent, setVolumePercent] = useState(30);
  const [seekPosition, setSeekPosition] = useState("0");
  const [selectedSource, setSelectedSource] = useState("");
  const [selectedSoundMode, setSelectedSoundMode] = useState("");
  const [repeatMode, setRepeatMode] = useState("off");
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [muted, setMuted] = useState(false);
  const [playMediaId, setPlayMediaId] = useState("");
  const [playMediaType, setPlayMediaType] = useState("music");
  const [playEnqueue, setPlayEnqueue] = useState<"" | "add" | "next" | "play" | "replace">("");
  const [playAnnounce, setPlayAnnounce] = useState(false);
  const [playExtraJson, setPlayExtraJson] = useState("{}");
  const [joinMembersRaw, setJoinMembersRaw] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchType, setSearchType] = useState("music");
  const [browseType, setBrowseType] = useState("");
  const [browseId, setBrowseId] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [positionTick, setPositionTick] = useState(Date.now());
  const [coverBroken, setCoverBroken] = useState(false);
  const [timelinePosition, setTimelinePosition] = useState(0);
  const [isScrubbingTimeline, setIsScrubbingTimeline] = useState(false);
  const [timelineHoverValue, setTimelineHoverValue] = useState<number | null>(null);
  const [timelineHoverPercent, setTimelineHoverPercent] = useState(0);
  const liveSeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sourceList = useMemo(() => toArray(entity.attributes?.source_list), [entity.attributes?.source_list]);
  const soundModeList = useMemo(() => toArray(entity.attributes?.sound_mode_list), [entity.attributes?.sound_mode_list]);
  const groupMembers = useMemo(() => toArray(entity.attributes?.group_members), [entity.attributes?.group_members]);
  const mediaDuration = Number(entity.attributes?.media_duration);
  const mediaPositionBase = Number(entity.attributes?.media_position);
  const mediaPosUpdatedAt = entity.attributes?.media_position_updated_at ? Date.parse(String(entity.attributes.media_position_updated_at)) : NaN;
  const isPlaying = String(entity.state || "").toLowerCase() === "playing";

  const coverUrl = useMemo(() => {
    const picture = String(entity.attributes?.entity_picture || "").trim();
    if (picture.startsWith("http://") || picture.startsWith("https://")) return picture;

    const localPicture = String(entity.attributes?.entity_picture_local || "").trim();
    if (localPicture) {
      const haUrl = String(localStorage.getItem("ha_url") || "").replace(/\/$/, "");
      if (haUrl && localPicture.startsWith("/")) return `${haUrl}${localPicture}`;
      return localPicture;
    }

    if (picture) {
      const haUrl = String(localStorage.getItem("ha_url") || "").replace(/\/$/, "");
      if (haUrl && picture.startsWith("/")) return `${haUrl}${picture}`;
      return picture;
    }

    return "";
  }, [entity.attributes?.entity_picture, entity.attributes?.entity_picture_local]);

  const currentPosition = useMemo(() => {
    if (!Number.isFinite(mediaPositionBase)) return 0;
    if (!isPlaying || !Number.isFinite(mediaPosUpdatedAt)) return Math.max(0, mediaPositionBase);
    const elapsedSec = Math.max(0, (positionTick - mediaPosUpdatedAt) / 1000);
    const dynamic = mediaPositionBase + elapsedSec;
    if (Number.isFinite(mediaDuration) && mediaDuration > 0) return Math.min(mediaDuration, Math.max(0, dynamic));
    return Math.max(0, dynamic);
  }, [mediaPositionBase, mediaPosUpdatedAt, positionTick, isPlaying, mediaDuration]);

  const displayedPosition = isScrubbingTimeline ? timelinePosition : currentPosition;
  const timelinePercent = useMemo(() => {
    if (!Number.isFinite(mediaDuration) || mediaDuration <= 0) return 0;
    return Math.max(0, Math.min(100, (displayedPosition / mediaDuration) * 100));
  }, [displayedPosition, mediaDuration]);

  useEffect(() => {
    const v = Number(entity.attributes?.volume_level);
    if (Number.isFinite(v)) setVolumePercent(Math.max(0, Math.min(100, Math.round(v * 100))));
    const pos = Number(entity.attributes?.media_position);
    if (Number.isFinite(pos)) setSeekPosition(String(Math.max(0, Math.round(pos))));
    setSelectedSource(String(entity.attributes?.source || sourceList[0] || ""));
    setSelectedSoundMode(String(entity.attributes?.sound_mode || soundModeList[0] || ""));
    setRepeatMode(String(entity.attributes?.repeat || "off"));
    setShuffleEnabled(Boolean(entity.attributes?.shuffle));
    setMuted(Boolean(entity.attributes?.is_volume_muted));
    setJoinMembersRaw(groupMembers.join(", "));
    setLocalError(null);
    setCoverBroken(false);
    if (!isScrubbingTimeline && Number.isFinite(pos)) {
      setTimelinePosition(Math.max(0, pos));
    }
  }, [entity.entity_id, entity.last_updated]);

  useEffect(() => {
    if (!isPlaying) return;
    const t = setInterval(() => setPositionTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isPlaying]);

  useEffect(() => {
    return () => {
      if (liveSeekTimerRef.current) {
        clearTimeout(liveSeekTimerRef.current);
      }
    };
  }, []);

  const formatTime = (secondsRaw: number) => {
    const seconds = Math.max(0, Math.floor(Number.isFinite(secondsRaw) ? secondsRaw : 0));
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const formatVerboseTime = (secondsRaw: number) => {
    const seconds = Math.max(0, Math.floor(Number.isFinite(secondsRaw) ? secondsRaw : 0));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    if (h > 0) return `${h} H ${String(m).padStart(2, "0")} min ${String(s).padStart(2, "0")} sec`;
    if (m > 0) return `${m} min ${String(s).padStart(2, "0")} sec`;
    return `${s} sec`;
  };

  const runWithEntity = async (service: string, data: Record<string, any> = {}) => {
    setLocalError(null);
    await onRun(service, { entity_id: entity.entity_id, ...data });
  };

  const queueLiveTimelineSeek = (targetRaw: number, immediate = false) => {
    if (!hasService("media_seek")) return;
    const target = Math.max(0, Math.floor(targetRaw));
    setSeekPosition(String(target));

    if (liveSeekTimerRef.current) {
      clearTimeout(liveSeekTimerRef.current);
      liveSeekTimerRef.current = null;
    }

    if (immediate) {
      void runWithEntity("media_seek", { seek_position: target });
      return;
    }

    liveSeekTimerRef.current = setTimeout(() => {
      void runWithEntity("media_seek", { seek_position: target });
      liveSeekTimerRef.current = null;
    }, 220);
  };

  const submitPlayMedia = async () => {
    if (!playMediaId.trim()) return;
    const payload: Record<string, any> = {
      media_content_id: playMediaId.trim(),
      media_content_type: playMediaType.trim() || "music",
    };
    if (playEnqueue) payload.enqueue = playEnqueue;
    if (playAnnounce) payload.announce = true;
    const extra = playExtraJson.trim();
    if (extra && extra !== "{}") {
      try {
        payload.extra = JSON.parse(extra);
      } catch {
        setLocalError("Invalid JSON in play_media extra payload.");
        return;
      }
    }
    await runWithEntity("play_media", payload);
  };

  const submitJoin = async () => {
    const members = joinMembersRaw
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    if (members.length === 0) return;
    await runWithEntity("join", { group_members: members });
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
        <Speaker className="w-4 h-4 text-indigo-400" />
        Media Controller
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
        <div className="flex gap-3">
          <div className="w-20 h-20 rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden flex items-center justify-center shrink-0">
            {coverUrl && !coverBroken ? (
              <img
                src={coverUrl}
                alt={String(entity.attributes?.media_title || "cover")}
                className="w-full h-full object-cover"
                onError={() => setCoverBroken(true)}
              />
            ) : (
              <Music className="w-6 h-6 text-zinc-600" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-zinc-100 truncate">
              {String(entity.attributes?.media_title || "Nothing playing")}
            </div>
            <div className="text-xs text-zinc-400 truncate">{String(entity.attributes?.media_artist || "-")}</div>
            <div className="text-xs text-zinc-500 truncate">{String(entity.attributes?.media_album_name || "-")}</div>
            <div className="text-[11px] text-emerald-300 mt-1 truncate">
              {String(entity.attributes?.app_name || "Unknown app")}
            </div>
          </div>
        </div>
        {Number.isFinite(mediaDuration) && mediaDuration > 0 && (
          <div className="mt-3">
            <div
              className="relative"
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
                const hoverSec = ratio * mediaDuration;
                setTimelineHoverPercent(ratio * 100);
                setTimelineHoverValue(hoverSec);
              }}
              onMouseLeave={() => setTimelineHoverValue(null)}
            >
              <input
                type="range"
                min={0}
                max={Math.max(1, Math.floor(mediaDuration))}
                step={1}
                value={Math.max(0, Math.min(Math.floor(mediaDuration), Math.floor(displayedPosition)))}
                onMouseDown={() => setIsScrubbingTimeline(true)}
                onTouchStart={() => setIsScrubbingTimeline(true)}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setTimelinePosition(next);
                  setIsScrubbingTimeline(true);
                  queueLiveTimelineSeek(next, false);
                }}
                onMouseUp={() => {
                  setIsScrubbingTimeline(false);
                  queueLiveTimelineSeek(timelinePosition, true);
                }}
                onTouchEnd={() => {
                  setIsScrubbingTimeline(false);
                  queueLiveTimelineSeek(timelinePosition, true);
                }}
                className="w-full h-2 appearance-none rounded-full cursor-pointer"
                style={{
                  background: `linear-gradient(to right, rgb(16 185 129) 0%, rgb(16 185 129) ${timelinePercent}%, rgb(39 39 42) ${timelinePercent}%, rgb(39 39 42) 100%)`,
                }}
              />
              {timelineHoverValue !== null && (
                <div
                  className="absolute top-full mt-2 -translate-x-1/2 rounded-md border border-zinc-700 bg-zinc-900/95 px-2 py-1 text-[11px] text-zinc-200 whitespace-nowrap pointer-events-none"
                  style={{ left: `${timelineHoverPercent}%` }}
                >
                  {formatVerboseTime(timelineHoverValue)}
                </div>
              )}
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-zinc-500">
              <span>{formatTime(displayedPosition)}</span>
              <span>{formatTime(mediaDuration)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {hasService("turn_on") && <Button size="sm" variant="secondary" className={unifiedButtonClass} disabled={running} onClick={() => runWithEntity("turn_on")}>On</Button>}
        {hasService("turn_off") && <Button size="sm" variant="secondary" className={unifiedButtonClass} disabled={running} onClick={() => runWithEntity("turn_off")}>Off</Button>}
        {hasService("toggle") && <Button size="sm" variant="outline" className={unifiedButtonClass} disabled={running} onClick={() => runWithEntity("toggle")}>Toggle</Button>}
        {hasService("media_previous_track") && <Button size="sm" variant="ghost" className={unifiedButtonClass} disabled={running} onClick={() => runWithEntity("media_previous_track")}>Prev</Button>}
        {hasService("media_play") && <Button size="sm" variant="ghost" className={unifiedButtonClass} disabled={running} onClick={() => runWithEntity("media_play")}>Play</Button>}
        {hasService("media_pause") && <Button size="sm" variant="ghost" className={unifiedButtonClass} disabled={running} onClick={() => runWithEntity("media_pause")}>Pause</Button>}
        {hasService("media_play_pause") && <Button size="sm" variant="ghost" className={unifiedButtonClass} disabled={running} onClick={() => runWithEntity("media_play_pause")}>Play/Pause</Button>}
        {hasService("media_stop") && <Button size="sm" variant="ghost" className={unifiedButtonClass} disabled={running} onClick={() => runWithEntity("media_stop")}>Stop</Button>}
        {hasService("media_next_track") && <Button size="sm" variant="ghost" className={unifiedButtonClass} disabled={running} onClick={() => runWithEntity("media_next_track")}>Next</Button>}
        {hasService("clear_playlist") && <Button size="sm" variant="ghost" className={unifiedButtonClass} disabled={running} onClick={() => runWithEntity("clear_playlist")}>Clear Queue</Button>}
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-3">
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
          <Volume2 className="w-4 h-4" />
          Volume
        </div>
        <div>
          <div className="text-xs text-zinc-400 mb-1">Level ({volumePercent}%)</div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={volumePercent}
            onChange={(e) => setVolumePercent(Number(e.target.value))}
            className="w-full"
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {hasService("volume_set") && (
            <Button size="sm" variant="secondary" className={unifiedButtonClass} disabled={running} onClick={() => runWithEntity("volume_set", { volume_level: volumePercent / 100 })}>
              Set Volume
            </Button>
          )}
          {hasService("volume_down") && <Button size="sm" variant="ghost" className={unifiedButtonClass} disabled={running} onClick={() => runWithEntity("volume_down")}>Vol -</Button>}
          {hasService("volume_up") && <Button size="sm" variant="ghost" className={unifiedButtonClass} disabled={running} onClick={() => runWithEntity("volume_up")}>Vol +</Button>}
          {hasService("volume_mute") && (
            <Button
              size="sm"
              variant="outline"
              className={unifiedButtonClass}
              disabled={running}
              onClick={async () => {
                const next = !muted;
                await runWithEntity("volume_mute", { is_volume_muted: next });
                setMuted(next);
              }}
            >
              {muted ? "Unmute" : "Mute"}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {hasService("media_seek") && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
            <div className="text-xs font-medium text-zinc-300">Seek</div>
            <Input value={seekPosition} onChange={(e) => setSeekPosition(e.target.value)} type="number" placeholder="seconds" />
            <Button
              size="sm"
              variant="secondary"
              className={unifiedButtonClass}
              disabled={running}
              onClick={() => runWithEntity("media_seek", { seek_position: Number(seekPosition) || 0 })}
            >
              Apply Seek
            </Button>
          </div>
        )}

        {(hasService("shuffle_set") || hasService("repeat_set")) && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
            <div className="text-xs font-medium text-zinc-300 flex items-center gap-2">
              <Shuffle className="w-4 h-4" />
              Queue Mode
            </div>
            {hasService("shuffle_set") && (
              <label className="flex items-center justify-between text-xs text-zinc-300">
                Shuffle
                <input
                  type="checkbox"
                  checked={shuffleEnabled}
                  onChange={(e) => setShuffleEnabled(e.target.checked)}
                />
              </label>
            )}
            {hasService("repeat_set") && (
              <select
                value={repeatMode}
                onChange={(e) => setRepeatMode(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/40"
              >
                <option value="off">off</option>
                <option value="all">all</option>
                <option value="one">one</option>
              </select>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {hasService("shuffle_set") && (
                <Button size="sm" variant="secondary" className={`w-full ${unifiedButtonClass}`} disabled={running} onClick={() => runWithEntity("shuffle_set", { shuffle: shuffleEnabled })}>
                  Apply Shuffle
                </Button>
              )}
              {hasService("repeat_set") && (
                <Button size="sm" variant="secondary" className={`w-full ${unifiedButtonClass}`} disabled={running} onClick={() => runWithEntity("repeat_set", { repeat: repeatMode })}>
                  <Repeat className="w-4 h-4" />
                  Apply Repeat
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {(hasService("select_source") || hasService("select_sound_mode")) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {hasService("select_source") && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
              <div className="text-xs font-medium text-zinc-300">Source</div>
              <select
                value={selectedSource}
                onChange={(e) => setSelectedSource(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/40"
              >
                {sourceList.length === 0 && <option value="">No source_list from entity</option>}
                {sourceList.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <Button size="sm" variant="secondary" className={unifiedButtonClass} disabled={running || !selectedSource} onClick={() => runWithEntity("select_source", { source: selectedSource })}>
                Apply Source
              </Button>
            </div>
          )}

          {hasService("select_sound_mode") && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
              <div className="text-xs font-medium text-zinc-300">Sound Mode</div>
              <select
                value={selectedSoundMode}
                onChange={(e) => setSelectedSoundMode(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/40"
              >
                {soundModeList.length === 0 && <option value="">No sound_mode_list from entity</option>}
                {soundModeList.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <Button size="sm" variant="secondary" className={unifiedButtonClass} disabled={running || !selectedSoundMode} onClick={() => runWithEntity("select_sound_mode", { sound_mode: selectedSoundMode })}>
                Apply Sound Mode
              </Button>
            </div>
          )}
        </div>
      )}

      {hasService("play_media") && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
          <div className="text-xs font-medium text-zinc-300 flex items-center gap-2">
            <ListMusic className="w-4 h-4" />
            Play Media
          </div>
          <Input label="media_content_id" value={playMediaId} onChange={(e) => setPlayMediaId(e.target.value)} placeholder="URL / provider id / media id" />
          <Input label="media_content_type" value={playMediaType} onChange={(e) => setPlayMediaType(e.target.value)} placeholder="music, video, playlist, channel..." />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-zinc-400 block mb-1">enqueue</label>
              <select
                value={playEnqueue}
                onChange={(e) => setPlayEnqueue(e.target.value as "" | "add" | "next" | "play" | "replace")}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/40"
              >
                <option value="">default</option>
                <option value="add">add</option>
                <option value="next">next</option>
                <option value="play">play</option>
                <option value="replace">replace</option>
              </select>
            </div>
            <label className="flex items-center justify-between text-xs text-zinc-300 rounded-xl border border-zinc-800 px-3 py-2">
              announce
              <input type="checkbox" checked={playAnnounce} onChange={(e) => setPlayAnnounce(e.target.checked)} />
            </label>
          </div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">extra (JSON)</label>
            <textarea
              value={playExtraJson}
              onChange={(e) => setPlayExtraJson(e.target.value)}
              className="w-full min-h-20 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-none focus:border-emerald-500/40"
            />
          </div>
          <Button
            size="sm"
            variant="secondary"
            className={unifiedButtonClass}
            disabled={running || !playMediaId.trim()}
            onClick={async () => {
              await submitPlayMedia();
            }}
          >
            Play Media
          </Button>
        </div>
      )}

      {(hasService("join") || hasService("unjoin")) && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
          <div className="text-xs font-medium text-zinc-300">Grouping</div>
          {hasService("join") && (
            <>
              <Input
                label="group_members"
                value={joinMembersRaw}
                onChange={(e) => setJoinMembersRaw(e.target.value)}
                placeholder="media_player.kitchen, media_player.office"
              />
              <Button size="sm" variant="secondary" className={unifiedButtonClass} disabled={running} onClick={submitJoin}>
                Join Members
              </Button>
            </>
          )}
          {hasService("unjoin") && (
            <Button size="sm" variant="ghost" className={unifiedButtonClass} disabled={running} onClick={() => runWithEntity("unjoin")}>
              Unjoin
            </Button>
          )}
        </div>
      )}

      {(hasService("search_media") || hasService("browse_media")) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {hasService("search_media") && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
              <div className="text-xs font-medium text-zinc-300 flex items-center gap-2">
                <Search className="w-4 h-4" />
                Search Media
              </div>
              <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="query" />
              <Input value={searchType} onChange={(e) => setSearchType(e.target.value)} placeholder="music/video/playlist..." />
              <Button
                size="sm"
                variant="secondary"
                className={unifiedButtonClass}
                disabled={running || !searchQuery.trim()}
                onClick={() => runWithEntity("search_media", { media_content_id: searchQuery.trim(), media_content_type: searchType || "music" })}
              >
                Search
              </Button>
            </div>
          )}

          {hasService("browse_media") && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
              <div className="text-xs font-medium text-zinc-300">Browse Media</div>
              <Input value={browseType} onChange={(e) => setBrowseType(e.target.value)} placeholder="media_content_type (optional)" />
              <Input value={browseId} onChange={(e) => setBrowseId(e.target.value)} placeholder="media_content_id (optional)" />
              <Button
                size="sm"
                variant="secondary"
                className={unifiedButtonClass}
                disabled={running}
                onClick={() =>
                  runWithEntity("browse_media", {
                    media_content_type: browseType || undefined,
                    media_content_id: browseId || undefined,
                  })
                }
              >
                Browse
              </Button>
            </div>
          )}
        </div>
      )}

      {localError && (
        <div className="text-xs rounded-lg px-3 py-2 border border-red-900/70 bg-red-950/30 text-red-300">
          {localError}
        </div>
      )}
    </div>
  );
}
