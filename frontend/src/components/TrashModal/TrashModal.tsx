import { useEffect, useMemo } from "react";
import { useTrashStore } from "@/store/trashStore.ts";
import { useSettingsStore } from "@/store/settingsStore.ts";
import { Modal } from "@/components/ui/index.ts";
import "./TrashModal.css";

const TYPE_LABELS: Record<string, string> = {
  sessions: "Sessions",
  tickets: "Tickets",
  specs: "Specs",
};

const ALL_TYPES = Object.keys(TYPE_LABELS);

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function itemLabel(item: { id: string; type: string; context: Record<string, unknown>; display?: Record<string, unknown> }): string {
  // Check display data first (extracted from trashed files)
  const d = item.display;
  if (d?.name && typeof d.name === "string") return d.name;
  if (d?.title && typeof d.title === "string") return d.title;
  // Then context fields
  const ctx = item.context;
  const name = ctx.name ?? ctx.title;
  if (typeof name === "string" && name) return name;
  const reg = ctx.registryEntry as Record<string, unknown> | undefined;
  if (reg?.title && typeof reg.title === "string") return reg.title;
  const man = ctx.manifestEntry as Record<string, unknown> | undefined;
  if (man?.registryTitle && typeof man.registryTitle === "string") return man.registryTitle;
  if (man?.realPath && typeof man.realPath === "string") return man.realPath;
  return item.id;
}

function itemPreview(item: { type: string; display?: Record<string, unknown> }): string | null {
  const d = item.display;
  if (!d) return null;
  const parts: string[] = [];
  if (item.type === "sessions") {
    if (d.model && typeof d.model === "string") parts.push(d.model);
    if (d.skillId && typeof d.skillId === "string") parts.push(d.skillId);
    if (d.status && typeof d.status === "string") parts.push(d.status);
  } else if (item.type === "tickets") {
    if (d.type && typeof d.type === "string") parts.push(d.type);
    if (d.status && typeof d.status === "string") parts.push(d.status);
  }
  return parts.length > 0 ? parts.join(" \u00b7 ") : null;
}

function cascadeLabel(context: Record<string, unknown>): string | null {
  const cascaded = context.cascaded;
  if (!Array.isArray(cascaded) || cascaded.length === 0) return null;
  return `+ ${cascaded.length} cascaded`;
}

export function TrashModal() {
  const isOpen = useTrashStore((s) => s.isOpen);
  const items = useTrashStore((s) => s.items);
  const filter = useTrashStore((s) => s.filter);
  const loading = useTrashStore((s) => s.loading);
  const close = useTrashStore((s) => s.close);
  const setFilter = useTrashStore((s) => s.setFilter);
  const restoreItem = useTrashStore((s) => s.restoreItem);
  const purgeItem = useTrashStore((s) => s.purgeItem);
  const emptyAll = useTrashStore((s) => s.emptyAll);
  const retentionDays = useSettingsStore(
    (s) => (s.settings?.trash_retention_days as number | undefined) ?? 30,
  );

  // Count items per type
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const item of items) {
      m[item.type] = (m[item.type] ?? 0) + 1;
    }
    return m;
  }, [items]);

  // Filtered items
  const filtered = useMemo(
    () => (filter ? items.filter((i) => i.type === filter) : items),
    [items, filter],
  );

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  return (
    <Modal open={isOpen} onClose={close} align="top">
      <div className="trash-container">
        {/* Header */}
        <div className="trash-header">
          <div className="trash-header-left">
            <span className="trash-title">Trash</span>
            <span className="trash-count">{items.length} item{items.length !== 1 ? "s" : ""}</span>
          </div>
          <button
            className="trash-empty-btn"
            onClick={emptyAll}
            disabled={items.length === 0}
          >
            {filter ? `Empty ${TYPE_LABELS[filter] ?? filter}` : "Empty All"}
          </button>
        </div>

        {/* Filter pills */}
        <div className="trash-filters">
          <button
            className={`trash-pill ${filter === null ? "trash-pill--active" : ""}`}
            onClick={() => setFilter(null)}
          >
            All ({items.length})
          </button>
          {ALL_TYPES.map((t) => {
            const c = counts[t] ?? 0;
            if (c === 0) return null;
            return (
              <button
                key={t}
                className={`trash-pill ${filter === t ? "trash-pill--active" : ""}`}
                onClick={() => setFilter(t)}
              >
                {TYPE_LABELS[t]} ({c})
              </button>
            );
          })}
        </div>

        {/* Item list */}
        <div className="trash-list">
          {loading && <div className="trash-loading">Loading...</div>}
          {!loading && filtered.length === 0 && (
            <div className="trash-empty-msg">
              {filter ? `No trashed ${TYPE_LABELS[filter]?.toLowerCase() ?? filter}` : "Trash is empty"}
            </div>
          )}
          {!loading &&
            filtered.map((item) => {
              const cascade = cascadeLabel(item.context);
              const preview = itemPreview(item);
              return (
                <div key={`${item.type}-${item.id}`} className="trash-item">
                  <span className={`trash-item-dot trash-item-dot--${item.type}`} />
                  <div className="trash-item-info">
                    <span className="trash-item-name">
                      {itemLabel(item)}
                      {cascade && (
                        <span className="trash-item-meta" style={{ display: "inline", marginLeft: "var(--space-xs)" }}>
                          {cascade}
                        </span>
                      )}
                    </span>
                    {preview && (
                      <span className="trash-item-preview">{preview}</span>
                    )}
                    <span className="trash-item-meta">
                      <span className="trash-item-type">{item.type}</span>
                      <span>{formatDate(item.trashedAt)}</span>
                    </span>
                  </div>
                  <div className="trash-item-actions">
                    <button
                      className="trash-btn trash-btn--restore"
                      onClick={() => restoreItem(item.type, item.id)}
                    >
                      Restore
                    </button>
                    <button
                      className="trash-btn trash-btn--delete"
                      onClick={() => purgeItem(item.type, item.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
        </div>

        {/* Footer */}
        <div className="trash-footer">
          <span>Auto-purge: items older than {retentionDays} days</span>
          <span style={{ marginLeft: "auto" }}>Esc close</span>
        </div>
      </div>
    </Modal>
  );
}
