import { useState, useCallback, useRef, useEffect } from "react";
import { SKILLS } from "@/constants/skills.ts";
import { useSpecStore } from "@/store/specStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { MODELS, BETA_1M, getModelDef } from "@/utils/models.ts";
import { SkillGrid } from "@/components/shared/SkillGrid.tsx";
import { SpecSelector } from "@/components/shared/SpecSelector.tsx";
import { TicketSelector } from "@/components/shared/TicketSelector.tsx";
import { PromptPreview } from "./PromptPreview.tsx";
import "./DraftConfigCard.css";

const TURN_OPTIONS = [5, 10, 20, 50, 100];

interface DraftConfigCardProps {
  bonsaiSid: string;
}

export function DraftConfigCard({ bonsaiSid }: DraftConfigCardProps) {
  const session = useSessionStore((s) => s.sessions.get(bonsaiSid));
  const updateDraft = useSessionStore((s) => s.updateDraft);
  const startDraft = useSessionStore((s) => s.startDraft);
  const closeSession = useSessionStore((s) => s.closeSession);
  const endSession = useSessionStore((s) => s.endSession);
  const specs = useSpecStore((s) => s.specs);
  const tickets = useBoardStore((s) => s.tickets);

  const [editName, setEditName] = useState("");
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [specPickerOpen, setSpecPickerOpen] = useState(false);
  const [ticketPickerOpen, setTicketPickerOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [starting, setStarting] = useState(false);

  const skillPickerRef = useRef<HTMLDivElement>(null);
  const specPickerRef = useRef<HTMLDivElement>(null);
  const ticketPickerRef = useRef<HTMLDivElement>(null);

  // Sync name from session
  useEffect(() => {
    if (session) setEditName(session.name);
  }, [session?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close popovers on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (skillPickerOpen && skillPickerRef.current && !skillPickerRef.current.contains(e.target as Node)) {
        setSkillPickerOpen(false);
      }
      if (specPickerOpen && specPickerRef.current && !specPickerRef.current.contains(e.target as Node)) {
        setSpecPickerOpen(false);
      }
      if (ticketPickerOpen && ticketPickerRef.current && !ticketPickerRef.current.contains(e.target as Node)) {
        setTicketPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [skillPickerOpen, specPickerOpen, ticketPickerOpen]);

  // Debounced update helper
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedUpdate = useCallback(
    (changes: Parameters<typeof updateDraft>[1]) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setUpdating(true);
      debounceRef.current = setTimeout(async () => {
        try {
          await updateDraft(bonsaiSid, changes);
        } catch (err) {
          console.error("[DraftConfigCard] update failed:", err);
        } finally {
          setUpdating(false);
        }
      }, 300);
    },
    [bonsaiSid, updateDraft],
  );

  const handleStart = useCallback(async () => {
    setStarting(true);
    try {
      await startDraft(bonsaiSid);
    } catch (err) {
      console.error("[DraftConfigCard] start failed:", err);
      setStarting(false);
    }
  }, [bonsaiSid, startDraft]);

  const handleDiscard = useCallback(async () => {
    await endSession(bonsaiSid);
    closeSession(bonsaiSid);
  }, [bonsaiSid, endSession, closeSession]);

  if (!session || session.status !== "draft") return null;

  const skill = session.skillId ? SKILLS.find((s) => s.id === session.skillId) : null;
  const selectedSpecs = session.specIds
    .map((id) => specs.find((s) => s.id === id))
    .filter(Boolean);
  const use1M = session.betas.includes(BETA_1M);
  const modelDef = getModelDef(session.model);
  const attachedTicket = session.metaTicketId ? tickets.get(session.metaTicketId) : null;

  const buildConfig = (overrides: Partial<{ model: string; maxTurns: number; permissionMode: string; betas: string[]; effort: string | null }>) => ({
    model: overrides.model ?? session.model,
    maxTurns: overrides.maxTurns ?? session.maxTurns,
    permissionMode: overrides.permissionMode ?? session.permissionMode,
    streamText: true,
    betas: overrides.betas ?? session.betas,
    effort: overrides.effort !== undefined ? overrides.effort : session.effort,
  });

  return (
    <div className="draft-config-card">
      <div className="draft-config-header">
        <input
          className="draft-config-name-input"
          value={editName}
          onChange={(e) => {
            setEditName(e.target.value);
            debouncedUpdate({ name: e.target.value });
          }}
          maxLength={60}
          placeholder="Session name..."
        />
        <span className="draft-config-badge">draft</span>
        {updating && <span className="draft-config-updating">updating...</span>}
      </div>

      {/* Skill Row */}
      <div className="draft-config-row" ref={skillPickerRef}>
        <span className="draft-config-label">Skill</span>
        <div className="draft-config-value">
          {skill ? (
            <span className="draft-config-pill">
              {skill.icon} {skill.name}
              <button
                className="draft-config-pill-remove"
                onClick={() => debouncedUpdate({ skillId: null })}
              >
                {"\u00D7"}
              </button>
            </span>
          ) : (
            <span className="draft-config-muted">none</span>
          )}
          <button
            className="draft-config-action"
            onClick={() => setSkillPickerOpen(!skillPickerOpen)}
          >
            {skill ? "change" : "select"} {"\u25BE"}
          </button>
        </div>
        {skillPickerOpen && (
          <div className="draft-config-popover">
            <SkillGrid
              selectedId={session.skillId}
              onSelect={(id) => {
                debouncedUpdate({ skillId: id });
                setSkillPickerOpen(false);
              }}
              context={{ hasTicket: !!session.metaTicketId }}
            />
          </div>
        )}
      </div>

      {/* Specs Row */}
      <div className="draft-config-row" ref={specPickerRef}>
        <span className="draft-config-label">Specs</span>
        <div className="draft-config-value">
          {selectedSpecs.map((spec) => (
            <span key={spec!.id} className="draft-config-pill">
              {spec!.title}
              <button
                className="draft-config-pill-remove"
                onClick={() =>
                  debouncedUpdate({
                    specIds: session.specIds.filter((id) => id !== spec!.id),
                  })
                }
              >
                {"\u00D7"}
              </button>
            </span>
          ))}
          <button
            className="draft-config-action draft-config-action--dashed"
            onClick={() => setSpecPickerOpen(!specPickerOpen)}
          >
            + add spec
          </button>
        </div>
        {specPickerOpen && (
          <div className="draft-config-popover">
            <SpecSelector
              selectedIds={session.specIds}
              initiallyOpen
              inline
              onToggle={(id) => {
                const next = session.specIds.includes(id)
                  ? session.specIds.filter((s) => s !== id)
                  : [...session.specIds, id];
                debouncedUpdate({ specIds: next });
              }}
            />
          </div>
        )}
      </div>

      {/* Ticket Row */}
      <div className="draft-config-row" ref={ticketPickerRef}>
        <span className="draft-config-label">Ticket</span>
        <div className="draft-config-value">
          {attachedTicket ? (
            <span className="draft-config-pill">
              {attachedTicket.title}
              <button
                className="draft-config-pill-remove"
                onClick={() => debouncedUpdate({ metaTicketId: null })}
              >
                {"\u00D7"}
              </button>
            </span>
          ) : (
            <span className="draft-config-muted">none</span>
          )}
          <button
            className="draft-config-action draft-config-action--dashed"
            onClick={() => setTicketPickerOpen(!ticketPickerOpen)}
          >
            + attach to ticket
          </button>
        </div>
        {ticketPickerOpen && (
          <div className="draft-config-popover">
            <TicketSelector
              selectedId={session.metaTicketId ?? null}
              onSelect={(id) => {
                debouncedUpdate({ metaTicketId: id });
                setTicketPickerOpen(false);
              }}
            />
          </div>
        )}
      </div>

      {/* Config Row */}
      <div className="draft-config-row">
        <span className="draft-config-label">Config</span>
        <div className="draft-config-value draft-config-value--wrap">
          <span className="draft-config-inline">
            <span className="draft-config-hint">model:</span>
            <select
              className="draft-config-select draft-config-select--model"
              value={session.model}
              onChange={(e) => {
                const newModel = e.target.value;
                const newDef = getModelDef(newModel);
                const newBetas = !newDef?.supports1M
                  ? session.betas.filter((b) => b !== BETA_1M)
                  : session.betas;
                debouncedUpdate({ config: buildConfig({ model: newModel, betas: newBetas }) });
              }}
            >
              <optgroup label="Current">
                {MODELS.filter((m) => m.group === "current").map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Legacy">
                {MODELS.filter((m) => m.group === "legacy").map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </span>

          <span className="draft-config-inline">
            <span className="draft-config-hint">perms:</span>
            <select
              className="draft-config-select"
              value={session.permissionMode}
              onChange={(e) =>
                debouncedUpdate({ config: buildConfig({ permissionMode: e.target.value }) })
              }
            >
              {["default", "acceptEdits", "bypassPermissions", "plan"].map(
                (m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ),
              )}
            </select>
          </span>

          <span className="draft-config-inline">
            <span className="draft-config-hint">turns:</span>
            <span className="draft-config-pills">
              {TURN_OPTIONS.map((t) => (
                <button
                  key={t}
                  className={`draft-config-effort-pill ${session.maxTurns === t ? "draft-config-effort-pill--active" : ""}`}
                  onClick={() => debouncedUpdate({ config: buildConfig({ maxTurns: t }) })}
                >
                  {t}
                </button>
              ))}
            </span>
          </span>

          <span className="draft-config-inline">
            <span className="draft-config-hint">effort:</span>
            <span className="draft-config-pills">
              {([null, "low", "medium", "high", "max"] as const).map((e) => (
                <button
                  key={e ?? "auto"}
                  className={`draft-config-effort-pill ${session.effort === e ? "draft-config-effort-pill--active" : ""}`}
                  onClick={() => debouncedUpdate({ config: buildConfig({ effort: e }) })}
                >
                  {e ?? "auto"}
                </button>
              ))}
            </span>
          </span>

          {modelDef?.supports1M && (
            <label className="draft-config-checkbox">
              <input
                type="checkbox"
                checked={use1M}
                onChange={(e) => {
                  const newBetas = e.target.checked
                    ? [...session.betas.filter((b) => b !== BETA_1M), BETA_1M]
                    : session.betas.filter((b) => b !== BETA_1M);
                  debouncedUpdate({ config: buildConfig({ betas: newBetas }) });
                }}
              />
              1M context
            </label>
          )}
        </div>
      </div>

      {/* System Prompt Preview */}
      <PromptPreview
        systemPrompt={session.systemPrompt ?? ""}
        sections={session.promptSections}
      />

      {/* Actions */}
      <div className="draft-config-actions">
        <button className="draft-config-btn-discard" onClick={handleDiscard}>
          Discard
        </button>
        <button
          className="draft-config-btn-start"
          onClick={handleStart}
          disabled={starting}
        >
          {starting ? "Starting..." : "\u25B6 Start Session"}
        </button>
      </div>
    </div>
  );
}
