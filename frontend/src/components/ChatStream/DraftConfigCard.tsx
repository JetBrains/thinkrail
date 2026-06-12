import { useState, useCallback, useRef, useEffect } from "react";
import { DND_FILE_MIME } from "@/constants/branding.ts";
import { browseFiles } from "@/services/files.ts";
import { useSpecStore } from "@/store/specStore.ts";
import { useSettingsStore } from "@/store/settingsStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useRuntimeCapsStore } from "@/store/runtimeCapsStore.ts";
import { RuntimeFlags } from "@/components/shared/RuntimeFlags.tsx";
import { useBoardStore } from "@/store/boardStore.ts";
import { SkillGrid } from "@/components/shared/SkillGrid.tsx";
import { SpecSelector } from "@/components/shared/SpecSelector.tsx";
import { TicketSelector } from "@/components/shared/TicketSelector.tsx";
import { FileSelector } from "@/components/shared/FileSelector.tsx";
import { Dropdown } from "@/components/shared/Dropdown.tsx";
import { Card, Button } from "@/components/ui/index.ts";
import { PromptPreview } from "./PromptPreview.tsx";
import { StaleRefsBanner } from "@/components/shared/StaleRefsBanner.tsx";
import "./DraftConfigCard.css";

interface DraftConfigCardProps {
  thinkrailSid: string;
  readOnly?: boolean;
  /** Hide the Discard control. Used for stage-default drafts (auto-spawned
   *  by the ticket view) where discarding makes no sense. When omitted, the
   *  control is hidden automatically for sessions whose kind is "stage-default". */
  hideDiscard?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
}

export function DraftConfigCard({ thinkrailSid, readOnly, hideDiscard, onVisibilityChange }: DraftConfigCardProps) {
  const session = useSessionStore((s) => s.sessions.get(thinkrailSid));
  const updateDraft = useSessionStore((s) => s.updateDraft);
  const renameDraft = useSessionStore((s) => s.renameDraft);
  const startDraft = useSessionStore((s) => s.startDraft);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const getStaleSessionRefs = useSessionStore((s) => s.getStaleSessionRefs);
  const fixStaleSessionRefs = useSessionStore((s) => s.fixStaleSessionRefs);
  const specs = useSpecStore((s) => s.specs);
  const tickets = useBoardStore((s) => s.tickets);
  const skills = useSettingsStore((s) => s.skills);
  const caps = useRuntimeCapsStore((s) => s.capsByRuntime["claude"]);
  const models = caps?.models ?? [];
  const permissionModes = caps?.permissionModes ?? [];
  const effortLevels = caps?.effortLevels ?? [];
  const flags = caps?.flags ?? [];

  const [editName, setEditName] = useState("");
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [specPickerOpen, setSpecPickerOpen] = useState(false);
  const [ticketPickerOpen, setTicketPickerOpen] = useState(false);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [starting, setStarting] = useState(false);

  const skillPickerRef = useRef<HTMLDivElement>(null);
  const specPickerRef = useRef<HTMLDivElement>(null);
  const ticketPickerRef = useRef<HTMLDivElement>(null);
  const filePickerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // IntersectionObserver to track visibility (used in readOnly mode for sticky header)
  useEffect(() => {
    if (!onVisibilityChange || !cardRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => onVisibilityChange(entry.isIntersecting),
      { threshold: 0.1 },
    );
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [onVisibilityChange]);

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
      if (filePickerOpen && filePickerRef.current && !filePickerRef.current.contains(e.target as Node)) {
        setFilePickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [skillPickerOpen, specPickerOpen, ticketPickerOpen, filePickerOpen]);

  // Debounced update helper — clear pending timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedUpdate = useCallback(
    (changes: Parameters<typeof updateDraft>[1]) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setUpdating(true);
      debounceRef.current = setTimeout(async () => {
        try {
          await updateDraft(thinkrailSid, changes);
        } catch (err) {
          console.error("[DraftConfigCard] update failed:", err);
        } finally {
          setUpdating(false);
        }
      }, 300);
    },
    [thinkrailSid, updateDraft],
  );

  const handleStart = useCallback(async () => {
    setStarting(true);
    try {
      await startDraft(thinkrailSid, "");
    } catch (err) {
      console.error("[DraftConfigCard] start failed:", err);
      setStarting(false);
    }
  }, [thinkrailSid, startDraft]);

  const handleDiscard = useCallback(async () => {
    await deleteSession(thinkrailSid);
  }, [thinkrailSid, deleteSession]);

  if (!session) return null;
  if (!readOnly && session.status !== "draft") return null;

  const skill = session.skillId ? skills.find((s) => s.id === session.skillId) : null;
  const staleRefs = getStaleSessionRefs(thinkrailSid);
  const staleMessage = staleRefs
    ? [
        staleRefs.staleSpecIds.length > 0
          ? `${staleRefs.staleSpecIds.length} spec${staleRefs.staleSpecIds.length !== 1 ? "s" : ""} no longer exist${staleRefs.staleSpecIds.length !== 1 ? "" : "s"}`
          : null,
        staleRefs.staleSkillId ? "skill no longer exists" : null,
      ]
        .filter(Boolean)
        .join("; ")
    : null;
  const selectedSpecs = session.specIds
    .map((id) => specs.find((s) => s.id === id))
    .filter(Boolean);
  const modelDef = models.find((m) => m.value === session.model);
  const attachedTicket = session.ticketId ? tickets.get(session.ticketId) : null;

  const buildConfig = (
    overrides: Partial<{ model: string; permissionMode: string; effort: string; flags: Record<string, boolean> }>,
  ) => ({
    model: overrides.model ?? session.model,
    permissionMode: overrides.permissionMode ?? session.permissionMode,
    streamText: true,
    effort: overrides.effort !== undefined ? overrides.effort : session.effort,
    flags: overrides.flags ?? session.flags ?? {},
  });

  // ── Read-only mode: display-only rendering (used at session start) ──
  if (readOnly) {
    return (
      <Card className="draft-config-card draft-config-card--readonly" ref={cardRef}>
        <div className="draft-config-header">
          <span className="draft-config-name">{session.name}</span>
        </div>

        {staleMessage && (
          <StaleRefsBanner message={staleMessage} onFix={() => fixStaleSessionRefs(thinkrailSid)} />
        )}

        {/* Skill */}
        <div className="draft-config-row">
          <span className="draft-config-label">Skill</span>
          <div className="draft-config-value">
            {skill ? (
              <span className="draft-config-pill">
                {skill.icon} {skill.name}
              </span>
            ) : (
              <span className="draft-config-muted">none</span>
            )}
          </div>
        </div>

        {/* Specs */}
        <div className="draft-config-row">
          <span className="draft-config-label">Specs</span>
          <div className="draft-config-value">
            {selectedSpecs.length > 0
              ? selectedSpecs.map((spec) => (
                  <span key={spec!.id} className="draft-config-pill">
                    {spec!.title}
                  </span>
                ))
              : <span className="draft-config-muted">none</span>}
          </div>
        </div>

        {/* Ticket */}
        <div className="draft-config-row">
          <span className="draft-config-label">Ticket</span>
          <div className="draft-config-value">
            {attachedTicket ? (
              <span className="draft-config-pill">{attachedTicket.title}</span>
            ) : (
              <span className="draft-config-muted">none</span>
            )}
          </div>
        </div>

        {/* Files */}
        <div className="draft-config-row">
          <span className="draft-config-label">Files</span>
          <div className="draft-config-value">
            {session.filePaths.length > 0
              ? session.filePaths.map((p) => (
                  <span key={p} className="draft-config-pill" title={p}>
                    {p.includes("/") ? p.split("/").pop() : p}
                  </span>
                ))
              : <span className="draft-config-muted">none</span>}
          </div>
        </div>

        {/* Config */}
        <div className="draft-config-row">
          <span className="draft-config-label">Config</span>
          <div className="draft-config-value draft-config-value--wrap">
            <span className="draft-config-pill draft-config-pill--model">
              {modelDef?.label ?? session.model}
            </span>
            <span className="draft-config-pill">{session.permissionMode}</span>
            <span className="draft-config-pill">{session.effort} effort</span>
          </div>
        </div>

        {/* System Prompt Preview */}
        <PromptPreview
          systemPrompt={session.systemPrompt ?? ""}
          sections={session.promptSections}
        />
      </Card>
    );
  }

  return (
    <Card
      className={`draft-config-card${dragOver ? " draft-config-card--drag-over" : ""}`}
      ref={cardRef}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DND_FILE_MIME)) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const path = e.dataTransfer.getData(DND_FILE_MIME);
        if (path && !session.filePaths.includes(path)) {
          debouncedUpdate({ filePaths: [...session.filePaths, path] });
        }
      }}
    >
      <div className="draft-config-header">
        <input
          className="draft-config-name-input"
          value={editName}
          onChange={(e) => {
            setEditName(e.target.value);
            void renameDraft(thinkrailSid, e.target.value);
          }}
          maxLength={60}
          placeholder="Session name..."
        />
        <span className="draft-config-badge">draft</span>
        {updating && <span className="draft-config-updating">updating...</span>}
      </div>

      {staleMessage && (
        <StaleRefsBanner message={staleMessage} onFix={() => fixStaleSessionRefs(thinkrailSid)} />
      )}

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
              context={{ hasTicket: !!session.ticketId }}
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
                onClick={() => debouncedUpdate({ ticketId: null })}
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
              selectedId={session.ticketId ?? null}
              onSelect={(id) => {
                debouncedUpdate({ ticketId: id });
                setTicketPickerOpen(false);
              }}
            />
          </div>
        )}
      </div>

      {/* Files Row */}
      <div className="draft-config-row" ref={filePickerRef}>
        <span className="draft-config-label">Files</span>
        <div className="draft-config-value">
          {session.filePaths.map((p) => (
            <span key={p} className="draft-config-pill" title={p}>
              {p.includes("/") ? p.split("/").pop() : p}
              <button
                className="draft-config-pill-remove"
                onClick={() =>
                  debouncedUpdate({
                    filePaths: session.filePaths.filter((f) => f !== p),
                  })
                }
              >
                {"\u00D7"}
              </button>
            </span>
          ))}
          <button
            className="draft-config-action draft-config-action--dashed"
            onClick={() => setFilePickerOpen(!filePickerOpen)}
          >
            + attach file
          </button>
          <button
            className="draft-config-action draft-config-action--dashed"
            onClick={async () => {
              try {
                const data = await browseFiles();
                const paths = data.paths ?? [];
                if (paths.length > 0) {
                  const merged = [...session.filePaths, ...paths.filter((p) => !session.filePaths.includes(p))];
                  debouncedUpdate({ filePaths: merged });
                }
              } catch (err) {
                console.error("[DraftConfigCard] browse failed:", err);
              }
            }}
          >
            + external
          </button>
        </div>
        {filePickerOpen && (
          <div className="draft-config-popover">
            <FileSelector
              selectedPaths={session.filePaths}
              onToggle={(path) => {
                const next = session.filePaths.includes(path)
                  ? session.filePaths.filter((f) => f !== path)
                  : [...session.filePaths, path];
                debouncedUpdate({ filePaths: next });
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
            <Dropdown
              className="draft-config-dd"
              value={session.model}
              options={[
                ...(modelDef ? [] : [{ value: session.model, label: session.model }]),
                ...models.map((m) => ({ value: m.value, label: m.label })),
              ]}
              onChange={(v) => debouncedUpdate({ config: buildConfig({ model: v }) })}
            />
          </span>

          <span className="draft-config-inline">
            <span className="draft-config-hint">perms:</span>
            <Dropdown
              className="draft-config-dd"
              value={session.permissionMode}
              options={[
                ...(permissionModes.some((m) => m.value === session.permissionMode)
                  ? []
                  : [{ value: session.permissionMode, label: session.permissionMode }]),
                ...permissionModes.map((m) => ({ value: m.value, label: m.label })),
              ]}
              onChange={(v) => debouncedUpdate({ config: buildConfig({ permissionMode: v }) })}
            />
          </span>

          <span className="draft-config-inline">
            <span className="draft-config-hint">effort:</span>
            <Dropdown
              className="draft-config-dd"
              value={session.effort}
              options={[
                ...(effortLevels.some((e) => e.value === session.effort)
                  ? []
                  : [{ value: session.effort, label: session.effort }]),
                ...effortLevels.map((e) => ({ value: e.value, label: e.label })),
              ]}
              onChange={(v) => debouncedUpdate({ config: buildConfig({ effort: v }) })}
            />
          </span>

          {session.skillId === "ticket-implement" && (
            <span className="draft-config-inline" aria-label="Execution mode">
              <span className="draft-config-hint">mode:</span>
              <select
                className="draft-config-select"
                value={`${session.subagentMode ?? "step-session"}:${session.stepGate ?? "approve"}`}
                onChange={(e) => {
                  const [mode, gate] = e.target.value.split(":") as [
                    "step-session" | "subagent",
                    "approve" | "autonomous",
                  ];
                  debouncedUpdate({ subagentMode: mode, stepGate: gate });
                }}
              >
                <option value="step-session:approve">step sessions (approve each)</option>
                <option value="subagent:approve">subagents (approve each)</option>
                <option value="subagent:autonomous">subagents (autonomous)</option>
              </select>
            </span>
          )}

          {flags.some((f) => f.type === "boolean") && (
            <span className="draft-config-inline">
              <span className="runtime-flags">
                <RuntimeFlags
                  flags={flags}
                  value={session.flags ?? {}}
                  idPrefix="draft-flag"
                  onChange={(key, checked) =>
                    debouncedUpdate({
                      config: buildConfig({ flags: { ...session.flags, [key]: checked } }),
                    })
                  }
                />
              </span>
            </span>
          )}

        </div>
      </div>

      {/* System Prompt Preview */}
      <PromptPreview
        systemPrompt={session.systemPrompt ?? ""}
        sections={session.promptSections}
        unsaved={session.unsaved}
      />

      {/* Actions */}
      <div className="draft-config-actions">
        {!(hideDiscard ?? session?.kind === "stage-default") && (
          <Button variant="default" onClick={handleDiscard}>
            Discard
          </Button>
        )}
        <Button
          variant="primary"
          onClick={handleStart}
          disabled={starting}
        >
          {starting ? "Starting..." : "\u25B6 Start Session"}
        </Button>
      </div>
    </Card>
  );
}
