import type { TemplateInfo, TemplateScope } from "@thinkrail/contracts";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib";
import { useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { assembleTemplate, stripFrontmatter } from "./templateText";

/** Documentation only (not itself parsed) — the real grammar is `slotSession.ts`'s parser / pi's own
 * expansion. Kept as a constant (not inline JSX text) since `${1:-default}` would otherwise be misread
 * as an embedded JS expression by JSX; the `\${` escape makes the dollar-brace literal. */
const SYNTAX_HINT = `$1, $ARGUMENTS, \${1:-default} — pi prompt-template syntax`;

const INPUT_CLASS =
	"w-full rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-md py-sm text-sm text-text outline-none transition-colors placeholder:text-hint focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--primary-20)] disabled:opacity-50";

/**
 * Mirrors the server's `isValidTemplateName` (`packages/server/src/templates/templates.ts`) exactly — a
 * path-traversal safety gate, not a naming-style rule. Duplicated rather than imported: that module is
 * server-only and never reaches the browser bundle (the same reasoning `HistoryOverlay.tsx`'s duplicated
 * `relativeTime` comment documents for a different helper).
 */
function isValidTemplateName(name: string): boolean {
	if (name.length === 0) return false;
	if (name.startsWith(".")) return false;
	return !name.includes("/") && !name.includes("\\") && !name.includes("\0");
}

/**
 * The shared create/edit surface for prompt-template files — reused by `panels/TemplatesSettings.tsx`
 * (New/Edit) and `HistoryOverlay`'s save-as-template action. Lives in `chat/` (a sanctioned boundary
 * exception, alongside `ChatView.tsx`/`useHistorySearch.ts`): `panels/` may import `chat/`, never the
 * reverse, and `HistoryOverlay` — which needs this same dialog — lives in `chat/`. See the module SPEC's
 * Save-as-template bullet for the full design writeup.
 *
 * Editing an existing template (`template` set) locks name + scope: `template.save` is create-or-overwrite
 * keyed by `(scope, name)` with no rename/move primitive, so changing either while editing would silently
 * orphan the old file instead of renaming it. Creating new (including save-as-template, via `initialBody`)
 * leaves both fully editable.
 */
export function TemplateEditorDialog({
	open,
	onOpenChange,
	workspaceId,
	template,
	initialScope = "global",
	initialBody = "",
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The active workspace, if any — gates whether "This project" is selectable at all. */
	workspaceId: string | undefined;
	/** Editing an existing template locks its name + scope. Omit (or `null`) for a brand-new template. */
	template?: TemplateInfo | null;
	/** New-template only: which scope starts selected (still fully editable). */
	initialScope?: TemplateScope;
	/** New-template only: prefills the body — the save-as-template case. */
	initialBody?: string;
}) {
	const [name, setName] = useState("");
	const [scope, setScope] = useState<TemplateScope>("global");
	const [description, setDescription] = useState("");
	const [argumentHint, setArgumentHint] = useState("");
	const [body, setBody] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const editing = template != null;

	// Reset the form on every open — seeded from the template being edited, or the New/save-as-template
	// prefill. Depending on `template`/`initialScope`/`initialBody` (not just `open`) means a *second* New
	// or Edit while the dialog stays mounted also reseeds correctly, not just the open transition.
	useEffect(() => {
		if (!open) return;
		setError(null);
		setSaving(false);
		if (template) {
			setName(template.name);
			setScope(template.scope);
			// Field values come from the server-parsed `TemplateInfo` — pi's real YAML parser read them, so
			// every scalar style (single-quoted, folded/block, …) arrives as its VALUE. The client-side
			// helper is used only to locate the body (a boundary rule, not YAML) — hand-parsing values here
			// once corrupted a pi-native `description: 'quoted'` into a form value with literal quotes.
			setDescription(template.description ?? "");
			setArgumentHint(template.argumentHint ?? "");
			setBody(stripFrontmatter(template.content));
		} else {
			setName("");
			setScope(initialScope);
			setDescription("");
			setArgumentHint("");
			setBody(initialBody);
		}
	}, [open, template, initialScope, initialBody]);

	const save = async () => {
		if (saving) return;
		const trimmedName = name.trim();
		if (!isValidTemplateName(trimmedName)) {
			setError('Name can\'t be empty, start with ".", or contain "/", "\\", or a null byte.');
			return;
		}
		if (scope === "project" && !workspaceId) {
			setError("Open a workspace first — a project-scoped template needs one.");
			return;
		}
		setSaving(true);
		setError(null);
		try {
			await getTransport().request("template.save", {
				...(workspaceId ? { workspaceId } : {}),
				scope,
				name: trimmedName,
				content: assembleTemplate(description, argumentHint, body),
			});
			useAppStore.getState().bumpTemplatesVersion();
			onOpenChange(false);
		} catch (err) {
			setError(errorText(err));
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent data-testid="template-editor-dialog" className="max-w-[36rem] gap-md">
				<DialogHeader>
					<DialogTitle>{editing ? `Edit ${template.name}` : "New template"}</DialogTitle>
				</DialogHeader>

				<div className="flex max-h-[60vh] flex-col gap-md overflow-y-auto">
					<Field id="template-name" label="Name">
						<input
							id="template-name"
							data-testid="template-name-input"
							value={name}
							disabled={editing}
							onChange={(e) => setName(e.target.value)}
							placeholder="standup"
							spellCheck={false}
							className={INPUT_CLASS}
						/>
					</Field>

					<div className="flex flex-col gap-xs">
						<span className="font-medium text-sm text-text">Scope</span>
						<div className="flex gap-sm">
							<ScopeOption
								id="global"
								label="Global"
								active={scope === "global"}
								disabled={editing}
								onSelect={() => setScope("global")}
							/>
							<ScopeOption
								id="project"
								label="This project"
								active={scope === "project"}
								disabled={editing || !workspaceId}
								onSelect={() => setScope("project")}
							/>
						</div>
						{!workspaceId && !editing ? (
							<p className="text-hint text-xs">
								Open a workspace to save a project-scoped template.
							</p>
						) : null}
					</div>

					<Field id="template-description" label="Description">
						<input
							id="template-description"
							data-testid="template-description-input"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="What this template is for"
							spellCheck={false}
							className={INPUT_CLASS}
						/>
					</Field>

					<Field id="template-argument-hint" label="Argument hint">
						<input
							id="template-argument-hint"
							data-testid="template-argument-hint-input"
							value={argumentHint}
							onChange={(e) => setArgumentHint(e.target.value)}
							placeholder="[file] [scope]"
							spellCheck={false}
							className={INPUT_CLASS}
						/>
					</Field>

					<Field id="template-body" label="Body">
						<Textarea
							id="template-body"
							data-testid="template-body-input"
							value={body}
							onChange={(e) => setBody(e.target.value)}
							placeholder="Prompt body…"
							spellCheck={false}
							rows={8}
						/>
						<p className="text-hint text-xs">{SYNTAX_HINT}</p>
					</Field>

					{error ? (
						<p data-testid="template-error" className="text-red text-xs">
							{error}
						</p>
					) : null}
				</div>

				<DialogFooter>
					<Button
						data-testid="template-cancel"
						variant="outline"
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<Button
						data-testid="template-save"
						disabled={saving || !name.trim()}
						onClick={() => void save()}
					>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** A labelled form field — an explicit `htmlFor`/`id` pairing (each caller passes the same `id` to its
 * control) rather than a label wrapping opaque children: the association stays statically checkable,
 * and non-control children (the Body field's syntax hint) aren't nested inside a `<label>`. */
function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
	return (
		<div className="flex flex-col gap-xs text-sm">
			<label htmlFor={id} className="font-medium text-text">
				{label}
			</label>
			{children}
		</div>
	);
}

/** One option in the scope toggle — `aria-pressed`, matching `AppearanceSettings`'s theme-option button
 * pattern exactly (not a native `<input type="radio">` — no such primitive exists in `components/ui`, and
 * this keeps the same token-styled toggle look as every other exclusive-choice control in the app). */
function ScopeOption({
	id,
	label,
	active,
	disabled,
	onSelect,
}: {
	id: TemplateScope;
	label: string;
	active: boolean;
	disabled: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={active}
			data-testid={`template-scope-${id}`}
			data-active={active}
			disabled={disabled}
			onClick={onSelect}
			className={cn(
				"flex-1 rounded-[var(--radius-md)] border px-md py-sm text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50",
				active
					? "border-[var(--primary-40)] bg-[var(--primary-10)] text-text"
					: "border-border2 text-muted hover:bg-hover hover:text-text",
			)}
		>
			{label}
		</button>
	);
}
