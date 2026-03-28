import { useState, useCallback, useRef, useEffect } from "react";
import { SKILLS } from "@/constants/skills.ts";
import { useSpecStore } from "@/store/specStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { MODELS, BETA_1M, getModelDef } from "@/utils/models.ts";
import { SkillGrid } from "@/components/NewSessionModal/SkillGrid.tsx";
import { SpecSelector } from "@/components/NewSessionModal/SpecSelector.tsx";
import "./DraftConfigCard.css";

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

  const [promptExpanded, setPromptExpanded] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [specPickerOpen, setSpecPickerOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [starting, setStarting] = useState(false);

  const skillPickerRef = useRef<HTMLDivElement>(null);
  const specPickerRef = useRef<HTMLDivElement>(null);

  // Close popovers on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (skillPickerOpen && skillPickerRef.current && !skillPickerRef.current.contains(e.target as Node)) {
        setSkillPickerOpen(false);
      }
      if (specPickerOpen && specPickerRef.current && !specPickerRef.current.contains(e.target as Node)) {
        setSpecPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [skillPickerOpen, specPickerOpen]);

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

  return (
    <div className="draft-config-card">
      <div className="draft-config-header">
        <span className="draft-config-title">Session Configuration</span>
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
                debouncedUpdate({
                  config: {
                    model: newModel,
                    maxTurns: session.maxTurns,
                    permissionMode: session.permissionMode,
                    streamText: true,
                    betas: newBetas,
                    effort: session.effort,
                  },
                });
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
                debouncedUpdate({
                  config: {
                    model: session.model,
                    maxTurns: session.maxTurns,
                    permissionMode: e.target.value,
                    streamText: true,
                    betas: session.betas,
                    effort: session.effort,
                  },
                })
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
            <span className="draft-config-hint">effort:</span>
            <span className="draft-config-pills">
              {([null, "low", "medium", "high", "max"] as const).map((e) => (
                <button
                  key={e ?? "auto"}
                  className={`draft-config-effort-pill ${session.effort === e ? "draft-config-effort-pill--active" : ""}`}
                  onClick={() =>
                    debouncedUpdate({
                      config: {
                        model: session.model,
                        maxTurns: session.maxTurns,
                        permissionMode: session.permissionMode,
                        streamText: true,
                        betas: session.betas,
                        effort: e,
                      },
                    })
                  }
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
                  debouncedUpdate({
                    config: {
                      model: session.model,
                      maxTurns: session.maxTurns,
                      permissionMode: session.permissionMode,
                      streamText: true,
                      betas: newBetas,
                      effort: session.effort,
                    },
                  });
                }}
              />
              1M context
            </label>
          )}
        </div>
      </div>

      {/* System Prompt Preview */}
      <div className="draft-config-prompt">
        <button
          className="draft-config-prompt-toggle"
          onClick={() => setPromptExpanded(!promptExpanded)}
        >
          {promptExpanded ? "\u25BC" : "\u25B6"} System Prompt
          {session.systemPrompt && (
            <span className="draft-config-prompt-size">
              ({Math.ceil(session.systemPrompt.length / 4).toLocaleString()} est. tokens)
            </span>
          )}
        </button>
        {promptExpanded && session.systemPrompt && (
          <div className="draft-config-prompt-body">
            <pre>{session.systemPrompt}</pre>
          </div>
        )}
      </div>

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
