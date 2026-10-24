import type { TemplateInfo, TemplateScope } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { Textarea } from "@thinkrail/ui/textarea";
import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { assembleTemplate, stripFrontmatter } from "@/prompt";
import { useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";

const INPUT_CLASS =
	"w-full rounded-sm border border-control-border-default bg-control-bg px-12 py-8 tr-text-ui text-text-default outline-none transition-colors placeholder:text-text-muted focus-visible:border-control-border-active disabled:bg-control-disabled-bg disabled:text-control-disabled-text";

function isValidTemplateName(name: string): boolean {
	if (name.length === 0) return false;
	if (name.startsWith(".")) return false;
	return !name.includes("/") && !name.includes("\\") && !name.includes("\0");
}

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
	workspaceId: string | undefined;
	template?: TemplateInfo | null;
	initialScope?: TemplateScope;
	initialBody?: string;
}) {
	const t = useT();
	const [name, setName] = useState("");
	const [scope, setScope] = useState<TemplateScope>("global");
	const [description, setDescription] = useState("");
	const [argumentHint, setArgumentHint] = useState("");
	const [body, setBody] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const editing = template != null;

	const [loading, setLoading] = useState(false);
	useEffect(() => {
		if (!open) return;
		setError(null);
		setSaving(false);
		if (template) {
			setName(template.name);
			setScope(template.scope);
			setDescription(template.description ?? "");
			setArgumentHint(template.argumentHint ?? "");
			setBody("");
			setLoading(true);
			let cancelled = false;
			getTransport()
				.request("template.get", {
					...(workspaceId ? { workspaceId } : {}),
					name: template.name,
					scope: template.scope,
				})
				.then((loaded) => {
					if (cancelled) return;
					setDescription(loaded.description ?? "");
					setArgumentHint(loaded.argumentHint ?? "");
					setBody(stripFrontmatter(loaded.content));
					setLoading(false);
				})
				.catch((err) => {
					if (cancelled) return;
					setError(errorText(err));
				});
			return () => {
				cancelled = true;
			};
		}
		setName("");
		setScope(initialScope);
		setDescription("");
		setArgumentHint("");
		setBody(initialBody);
		setLoading(false);
		return undefined;
	}, [open, template, initialScope, initialBody, workspaceId]);

	const save = async () => {
		if (saving) return;
		const finalName = template ? template.name : name.trim();
		if (!isValidTemplateName(finalName)) {
			setError(t("chat.templateEditor.invalidName"));
			return;
		}
		if (scope === "project" && !workspaceId) {
			setError(t("chat.templateEditor.projectNeedsWorkspace"));
			return;
		}
		setSaving(true);
		setError(null);
		const persist = async () => {
			await getTransport().request("template.save", {
				...(workspaceId ? { workspaceId } : {}),
				scope,
				name: finalName,
				content: assembleTemplate(description, argumentHint, body),
			});
			useAppStore.getState().bumpTemplatesVersion();
			onOpenChange(false);
		};
		await persist()
			.catch((err: unknown) => setError(errorText(err)))
			.finally(() => setSaving(false));
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent data-testid="template-editor-dialog" className="max-w-[36rem] gap-12">
				<DialogHeader>
					<DialogTitle>
						{editing
							? t("chat.templateEditor.editTitle", { name: template.name })
							: t("chat.templateEditor.newTitle")}
					</DialogTitle>
				</DialogHeader>

				<div className="flex max-h-[60vh] flex-col gap-12 overflow-y-auto">
					<Field id="template-name" label={t("chat.templateEditor.name")}>
						<input
							id="template-name"
							data-testid="template-name-input"
							value={name}
							disabled={editing}
							onChange={(e) => setName(e.target.value)}
							placeholder={t("chat.templateEditor.namePlaceholder")}
							spellCheck={false}
							className={INPUT_CLASS}
						/>
					</Field>

					<div className="flex flex-col gap-4">
						<span className="tr-title-compact text-text-default">
							{t("chat.templateEditor.scope")}
						</span>
						<div className="flex gap-8">
							<ScopeOption
								id="global"
								label={t("chat.templateEditor.scopeGlobal")}
								active={scope === "global"}
								disabled={editing}
								onSelect={() => setScope("global")}
							/>
							<ScopeOption
								id="project"
								label={t("chat.templateEditor.scopeProject")}
								active={scope === "project"}
								disabled={editing || !workspaceId}
								onSelect={() => setScope("project")}
							/>
						</div>
						{!workspaceId && !editing ? (
							<p className="text-text-muted tr-text-metadata">
								{t("chat.templateEditor.projectScopeHint")}
							</p>
						) : null}
					</div>

					<Field id="template-description" label={t("chat.templateEditor.description")}>
						<input
							id="template-description"
							data-testid="template-description-input"
							disabled={loading}
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder={t("chat.templateEditor.descriptionPlaceholder")}
							spellCheck={false}
							className={INPUT_CLASS}
						/>
					</Field>

					<Field id="template-argument-hint" label={t("chat.templateEditor.argumentHint")}>
						<input
							id="template-argument-hint"
							data-testid="template-argument-hint-input"
							disabled={loading}
							value={argumentHint}
							onChange={(e) => setArgumentHint(e.target.value)}
							placeholder={t("chat.templateEditor.argumentHintPlaceholder")}
							spellCheck={false}
							className={INPUT_CLASS}
						/>
					</Field>

					<Field id="template-body" label={t("chat.templateEditor.body")}>
						<Textarea
							id="template-body"
							data-testid="template-body-input"
							disabled={loading}
							value={body}
							onChange={(e) => setBody(e.target.value)}
							placeholder={t("chat.templateEditor.bodyPlaceholder")}
							spellCheck={false}
							rows={8}
						/>
						<p className="text-text-muted tr-text-metadata">
							{t("chat.templateEditor.syntaxHint")}
						</p>
					</Field>

					{error ? (
						<p data-testid="template-error" className="text-feedback-error tr-text-metadata">
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
						{t("common.cancel")}
					</Button>
					<Button
						data-testid="template-save"
						disabled={saving || loading || (!editing && !name.trim())}
						onClick={() => void save()}
					>
						{t("common.save")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
	return (
		<div className="flex flex-col gap-4 tr-text-ui">
			<label htmlFor={id} className="tr-text-emphasis text-text-default">
				{label}
			</label>
			{children}
		</div>
	);
}

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
				"flex-1 rounded-sm border px-12 py-8 text-left tr-text-ui outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:bg-control-disabled-bg disabled:text-control-disabled-text",
				active
					? "border-primary-muted bg-clip-padding bg-primary-subtle text-text-default"
					: "border-border-default text-text-muted hover:bg-control-bg-hovered hover:text-text-default",
			)}
		>
			{label}
		</button>
	);
}
