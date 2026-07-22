import type { CombineMode, HookName, HookSource, HookValue } from "@thinkrail/contracts";
import { TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib";
import { toast } from "../store";
import { errorText } from "../transport";
import { getProjectHooks, saveProjectHooks } from "./hooksActions";

const HOOKS: { name: HookName; label: string; description: string }[] = [
	{
		name: "onCreate",
		label: "onCreate",
		description: "Runs once, right after a workspace is created.",
	},
	{
		name: "onDelete",
		label: "onDelete",
		description: "Runs before a workspace's worktree is removed.",
	},
	{
		name: "preMerge",
		label: "preMerge",
		description: "Runs before a merge; a non-zero exit blocks it. (No merge flow exists yet.)",
	},
	{
		name: "postMerge",
		label: "postMerge",
		description: "Runs in the background after a successful merge. (No merge flow exists yet.)",
	},
];

const COMBINE_MODES: { value: CombineMode; label: string }[] = [
	{ value: "both", label: "Both" },
	{ value: "shared", label: "Shared only" },
	{ value: "local", label: "Local only" },
];

const COMBINE_MODE_HINT: Record<CombineMode, string> = {
	both: "Runs Shared, then Local, for every event.",
	shared: "Runs Shared only — Local hooks are ignored.",
	local: "Runs Local only — Shared hooks are ignored.",
};

const SOURCE_LABEL: Record<HookSource, string> = { shared: "Shared", local: "Local" };

const INLINE_PLACEHOLDER = "npm install";
const SCRIPT_PLACEHOLDER = ".thinkrail/hooks/setup.sh";

const FIELD_CLASS =
	"w-full rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-sm py-xs font-[var(--font-mono)] text-xs text-text outline-none transition-colors placeholder:text-hint focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--primary-20)] disabled:opacity-50";

type SourceFieldState = {
	mode: "inline" | "script";
	value: string;
	approved: boolean;
};

type FieldsState = Record<HookName, Record<HookSource, SourceFieldState>>;

function emptySourceField(): SourceFieldState {
	return { mode: "inline", value: "", approved: false };
}

function emptyFields(): FieldsState {
	const fields = {} as FieldsState;
	for (const { name } of HOOKS)
		fields[name] = { shared: emptySourceField(), local: emptySourceField() };
	return fields;
}

function sourceFieldFrom(value: HookValue | undefined, approved: boolean): SourceFieldState {
	if (value == null) return { mode: "inline", value: "", approved };
	if (typeof value === "string") return { mode: "inline", value, approved };
	if ("script" in value) return { mode: "script", value: value.script, approved };
	return { mode: "inline", value: value.command, approved };
}

function fieldsFromPayload(payload: {
	shared: Partial<Record<HookName, HookValue>>;
	local: Partial<Record<HookName, HookValue>>;
	approved: Partial<Record<HookName, Partial<Record<HookSource, boolean>>>>;
}): FieldsState {
	const fields = {} as FieldsState;
	for (const { name } of HOOKS) {
		fields[name] = {
			shared: sourceFieldFrom(payload.shared[name], payload.approved[name]?.shared ?? false),
			local: sourceFieldFrom(payload.local[name], payload.approved[name]?.local ?? false),
		};
	}
	return fields;
}

/** Empty/blank → absent (lets a save clear a previously-set value); Script mode → `{ script }`; else the
 * trimmed inline string. */
function toHookValue(field: SourceFieldState): HookValue | undefined {
	const trimmed = field.value.trim();
	if (!trimmed) return undefined;
	return field.mode === "script" ? { script: trimmed } : trimmed;
}

/**
 * The project-level hooks config surface: a combine-mode control plus, per `HookName`, a Shared and a
 * Local sub-field (each an Inline-command/Script-path toggle) — reachable with zero workspaces (this
 * dialog's own `project.hooks.get`/`.save` calls need only a `projectId`). Saving writes + commits Shared
 * (skipped entirely when the project gitignores `.thinkrail/`, never force-committed) and persists Local,
 * then **approves** everything it wrote on this machine — there's no separate Approve step here; the
 * reactive per-workspace `HookApprovalDialog` stays for commands the user didn't just author themselves
 * (e.g. a teammate's committed Shared hook pulled fresh).
 */
export function ProjectHooksDialog({
	open,
	projectId,
	projectName,
	onOpenChange,
}: {
	open: boolean;
	projectId: string;
	projectName: string;
	onOpenChange: (open: boolean) => void;
}) {
	const [combineMode, setCombineMode] = useState<CombineMode>("both");
	const [sharedCommittable, setSharedCommittable] = useState(true);
	const [fields, setFields] = useState<FieldsState>(emptyFields);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!open) return;
		setLoading(true);
		getProjectHooks(projectId)
			.then((payload) => {
				setCombineMode(payload.combineMode);
				setSharedCommittable(payload.sharedCommittable);
				setFields(fieldsFromPayload(payload));
			})
			.catch((err) => toast.error(errorText(err, "Failed to load hooks")))
			.finally(() => setLoading(false));
	}, [open, projectId]);

	const formDisabled = loading || saving;

	const setSourceField = (hook: HookName, source: HookSource, patch: Partial<SourceFieldState>) =>
		setFields((prev) => ({
			...prev,
			[hook]: { ...prev[hook], [source]: { ...prev[hook][source], ...patch } },
		}));

	const save = async () => {
		setSaving(true);
		try {
			const shared: Partial<Record<HookName, HookValue>> = {};
			// Never attempt to write Shared when it can't be committed — the Shared column is disabled in
			// that case, but its loaded state may still carry stale pre-gitignore content, which would
			// otherwise reach the server and trip its "can't commit" guard for a column the user never
			// touched.
			if (sharedCommittable) {
				for (const { name } of HOOKS) {
					const value = toHookValue(fields[name].shared);
					if (value !== undefined) shared[name] = value;
				}
			}
			const local: Partial<Record<HookName, HookValue>> = {};
			for (const { name } of HOOKS) {
				const value = toHookValue(fields[name].local);
				if (value !== undefined) local[name] = value;
			}
			await saveProjectHooks(projectId, { combineMode, shared, local });
			const refreshed = await getProjectHooks(projectId);
			setCombineMode(refreshed.combineMode);
			setSharedCommittable(refreshed.sharedCommittable);
			setFields(fieldsFromPayload(refreshed));
			toast.success("Hooks saved");
		} catch (err) {
			toast.error(errorText(err, "Failed to save hooks"));
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				data-testid="project-hooks-dialog"
				className="flex max-h-[85vh] w-full max-w-[42rem] flex-col gap-0 overflow-hidden p-0"
			>
				<DialogHeader className="gap-xs border-border2 border-b px-lg py-md">
					<DialogTitle>Hooks — {projectName}</DialogTitle>
					<p className="text-hint text-xs">
						Shared hooks are committed to <code>.thinkrail/hooks.json</code> and shared with your
						team; Local hooks stay on this machine only. Saving approves everything below on this
						machine — a new workspace runs it right away.
					</p>
				</DialogHeader>
				{loading ? (
					<p className="px-lg py-md text-hint text-sm">Loading…</p>
				) : (
					<div className="flex min-h-0 flex-1 flex-col gap-lg overflow-y-auto px-lg py-md">
						<CombineModeControl
							value={combineMode}
							onChange={setCombineMode}
							disabled={formDisabled}
						/>
						{!sharedCommittable && (
							<div
								data-testid="shared-uncommittable-note"
								className="flex items-start gap-sm rounded-[var(--radius-md)] border border-border2 border-l-[3px] border-l-[var(--gold)] bg-[var(--gold-tint)] px-sm py-xs text-xs text-text"
							>
								<TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-gold" />
								<span>
									This project ignores .thinkrail/ — shared hooks can't be committed here. Use a
									Local hook instead.
								</span>
							</div>
						)}
						{HOOKS.map(({ name, label, description }) => (
							<HookRow
								key={name}
								hook={name}
								label={label}
								description={description}
								shared={fields[name].shared}
								local={fields[name].local}
								sharedDisabled={!sharedCommittable || formDisabled}
								localDisabled={formDisabled}
								onChangeShared={(patch) => setSourceField(name, "shared", patch)}
								onChangeLocal={(patch) => setSourceField(name, "local", patch)}
								onRemoveShared={() => setSourceField(name, "shared", { value: "" })}
								onRemoveLocal={() => setSourceField(name, "local", { value: "" })}
							/>
						))}
					</div>
				)}
				<div className="flex justify-end gap-sm border-border2 border-t p-lg pt-md">
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
						Cancel
					</Button>
					<Button data-testid="save-hooks" onClick={() => void save()} disabled={formDisabled}>
						Save
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function CombineModeControl({
	value,
	onChange,
	disabled,
}: {
	value: CombineMode;
	onChange: (mode: CombineMode) => void;
	disabled: boolean;
}) {
	return (
		<div className="flex flex-col gap-xs">
			<span className="font-medium text-sm text-text">Combine mode</span>
			<div
				data-testid="hook-combine-mode"
				role="toolbar"
				aria-label="Combine mode"
				className="inline-flex items-center gap-xs self-start rounded-[var(--radius-md)] border border-border2 bg-bg-dark p-0.5"
			>
				{COMBINE_MODES.map(({ value: mode, label }) => (
					<ToggleSegment
						key={mode}
						testid={`hook-combine-mode-${mode}`}
						label={label}
						active={value === mode}
						disabled={disabled}
						onClick={() => onChange(mode)}
					/>
				))}
			</div>
			<p className="text-hint text-xs">{COMBINE_MODE_HINT[value]}</p>
		</div>
	);
}

function HookRow({
	hook,
	label,
	description,
	shared,
	local,
	sharedDisabled,
	localDisabled,
	onChangeShared,
	onChangeLocal,
	onRemoveShared,
	onRemoveLocal,
}: {
	hook: HookName;
	label: string;
	description: string;
	shared: SourceFieldState;
	local: SourceFieldState;
	sharedDisabled: boolean;
	localDisabled: boolean;
	onChangeShared: (patch: Partial<SourceFieldState>) => void;
	onChangeLocal: (patch: Partial<SourceFieldState>) => void;
	onRemoveShared: () => void;
	onRemoveLocal: () => void;
}) {
	return (
		<div className="flex flex-col gap-sm">
			<div>
				<h3 className="font-medium text-sm text-text">{label}</h3>
				<p className="text-hint text-xs">{description}</p>
			</div>
			<div className="grid grid-cols-1 gap-sm sm:grid-cols-2">
				<SourceField
					hook={hook}
					source="shared"
					field={shared}
					disabled={sharedDisabled}
					onChange={onChangeShared}
					onRemove={onRemoveShared}
				/>
				<SourceField
					hook={hook}
					source="local"
					field={local}
					disabled={localDisabled}
					onChange={onChangeLocal}
					onRemove={onRemoveLocal}
				/>
			</div>
		</div>
	);
}

function SourceField({
	hook,
	source,
	field,
	disabled,
	onChange,
	onRemove,
}: {
	hook: HookName;
	source: HookSource;
	field: SourceFieldState;
	disabled: boolean;
	onChange: (patch: Partial<SourceFieldState>) => void;
	onRemove: () => void;
}) {
	const hasValue = field.value.trim().length > 0;
	return (
		<div
			className={cn(
				"flex flex-col gap-xs rounded-[var(--radius-md)] border border-border2 bg-bg-dark p-sm",
				disabled && "opacity-60",
			)}
		>
			<div className="flex items-center justify-between gap-sm">
				<span className="font-medium text-hint text-xs uppercase tracking-wide">
					{SOURCE_LABEL[source]}
				</span>
				<div
					data-testid={`hook-${source}-mode-${hook}`}
					role="toolbar"
					aria-label={`${SOURCE_LABEL[source]} ${hook} value type`}
					className="flex items-center gap-xs"
				>
					<ToggleSegment
						testid={`hook-${source}-mode-${hook}-inline`}
						label="Inline"
						active={field.mode === "inline"}
						disabled={disabled}
						onClick={() => onChange({ mode: "inline" })}
					/>
					<ToggleSegment
						testid={`hook-${source}-mode-${hook}-script`}
						label="Script"
						active={field.mode === "script"}
						disabled={disabled}
						onClick={() => onChange({ mode: "script" })}
					/>
				</div>
			</div>
			{field.mode === "inline" ? (
				<Textarea
					data-testid={`hook-${source}-${hook}`}
					value={field.value}
					onChange={(e) => onChange({ value: e.target.value })}
					disabled={disabled}
					placeholder={INLINE_PLACEHOLDER}
					rows={3}
					className="whitespace-pre-wrap font-[var(--font-mono)] text-xs"
				/>
			) : (
				<input
					data-testid={`hook-${source}-${hook}`}
					value={field.value}
					onChange={(e) => onChange({ value: e.target.value })}
					disabled={disabled}
					placeholder={SCRIPT_PLACEHOLDER}
					className={FIELD_CLASS}
				/>
			)}
			<div className="flex items-center justify-between gap-sm text-xs">
				<span
					data-testid={`hook-approved-${source}-${hook}`}
					className={field.approved ? "text-green" : "text-hint"}
				>
					{field.approved ? "Approved" : "Not yet approved"}
				</span>
				<button
					type="button"
					data-testid={`hook-${source}-remove-${hook}`}
					aria-label={`Remove ${SOURCE_LABEL[source]} ${hook}`}
					onClick={onRemove}
					disabled={disabled || !hasValue}
					className="rounded-[var(--radius-sm)] p-0.5 text-hint outline-none transition-colors hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-40"
				>
					<X className="size-3.5" />
				</button>
			</div>
		</div>
	);
}

function ToggleSegment({
	testid,
	label,
	active,
	disabled,
	onClick,
}: {
	testid: string;
	label: string;
	active: boolean;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			data-testid={testid}
			data-active={active}
			aria-pressed={active}
			disabled={disabled}
			onClick={onClick}
			className={cn(
				"rounded-[var(--radius-sm)] px-sm py-0.5 text-xs transition-colors disabled:pointer-events-none disabled:opacity-50",
				active ? "bg-elevated text-text" : "text-hint hover:bg-hover hover:text-text",
			)}
		>
			{label}
		</button>
	);
}
