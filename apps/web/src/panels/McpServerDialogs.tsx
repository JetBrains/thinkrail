import {
	RiAddLine as Plus,
	RiDeleteBin6Line as Trash2,
	RiAlertLine as TriangleAlert,
} from "@remixicon/react";
import type {
	McpServerEntryInput,
	McpServerLog,
	McpServerScope,
	McpServerSummary,
} from "@thinkrail/contracts";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { Textarea } from "@thinkrail/ui/textarea";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { randomId } from "@/lib";
import type { McpServerRow } from "@/store";
import {
	buildMcpEntry,
	emptyMcpDraft,
	hasMcpValueCommands,
	hideMcpLiterals,
	importIssues,
	MCP_EXPOSURE_HINT,
	MCP_EXPOSURES,
	MCP_HIDDEN_VALUE,
	type McpFormDraft,
	type McpServerReview,
	mcpApprovalFacts,
	mcpDraftWarnings,
	mcpEditedEntry,
	mcpEndpointOf,
	mcpEntryErrors,
	mcpNameWarning,
	needsMcpReview,
	parseMcpServersJson,
	reviewMcpServer,
	SCOPE_LABEL,
	validateMcpDraft,
} from "./mcpEntries";
import { GITHUB_MCP_RECIPE_JSON, MCP_PRESETS, type McpPreset } from "./mcpPresets";
import { type McpRowView, mcpConfiguredExposureText, mcpExposureLabel } from "./mcpServerView";
import { ToggleSegment } from "./ToggleSegment";

const MCP_INPUT_CLASS =
	"w-full min-w-0 rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-8 py-4 tr-text-ui text-text-default outline-none placeholder:text-text-muted focus-visible:border-control-border-active disabled:border-control-disabled-border disabled:bg-control-disabled-bg disabled:text-control-disabled-text";

const NAME_REFERENCE = `\${NAME}`;

function CodeBlock({ testId, children }: { testId?: string; children: ReactNode }) {
	return (
		<code
			data-testid={testId}
			className="block whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-control-bg px-8 py-4 tr-code-text text-text-default"
		>
			{children}
		</code>
	);
}

export interface McpAddResult {
	name: string;
	error: string | null;
}

type McpAddServers = (
	servers: { name: string; entry: McpServerEntryInput }[],
	scope: McpServerScope,
) => Promise<McpAddResult[]>;

function DialogBody({ children }: { children: ReactNode }) {
	return (
		<div className="-mx-16 flex min-h-0 flex-1 flex-col gap-12 overflow-y-auto px-16">
			{children}
		</div>
	);
}

function runLabel(label: string): string {
	return label === "command" ? "Runs on this host" : `Runs to fill ${label}`;
}

function CommandSpeedHint() {
	return (
		<p data-testid="mcp-command-hint" className="text-text-muted tr-text-metadata">
			<code className="tr-code-text">!commands</code> run on the host each time a chat connects;
			keep them fast (e.g. read a cached token).
		</p>
	);
}

function Field({
	label,
	hint,
	error,
	children,
}: {
	label: string;
	hint?: ReactNode;
	error?: string | undefined;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-4">
			<span className="tr-title-compact text-text-default">{label}</span>
			{children}
			{error ? (
				<span role="alert" className="text-feedback-error tr-text-metadata">
					{error}
				</span>
			) : hint ? (
				<span className="text-text-muted tr-text-metadata">{hint}</span>
			) : null}
		</div>
	);
}

function Segments<T extends string>({
	value,
	options,
	testId,
	disabled,
	onChange,
}: {
	value: T;
	options: readonly { id: T; label: string; disabled?: boolean }[];
	testId: string;
	disabled?: boolean;
	onChange: (value: T) => void;
}) {
	return (
		<div className="flex flex-wrap items-center gap-2" data-testid={testId}>
			{options.map((option) => (
				<ToggleSegment
					key={option.id}
					testid={`${testId}-${option.id}`}
					label={option.label}
					active={value === option.id}
					disabled={disabled || option.disabled === true}
					onClick={() => onChange(option.id)}
				/>
			))}
		</div>
	);
}

export function McpRunReview({
	reviews,
	modifiesData,
}: {
	reviews: readonly McpServerReview[];
	modifiesData?: string | undefined;
}) {
	return (
		<div data-testid="mcp-run-review" className="flex flex-col gap-12">
			{modifiesData ? (
				<p className="flex items-start gap-8 text-feedback-warning tr-text-ui">
					<TriangleAlert className="mt-2 size-14 shrink-0" />
					This server can modify data in {modifiesData}.
				</p>
			) : null}
			{reviews.map((review) => (
				<section key={review.name} className="flex flex-col gap-4" data-testid="mcp-run-server">
					<h4 className="tr-title-compact text-text-default">{review.name}</h4>
					{review.runs.length === 0 ? (
						<p className="text-text-muted tr-text-metadata">Nothing runs on this host.</p>
					) : (
						<ul className="flex flex-col gap-4">
							{review.runs.map((run) => (
								<li
									key={`${run.label}:${run.text}`}
									data-testid="mcp-run-item"
									className="flex flex-col gap-2"
								>
									<span className="text-text-muted tr-text-metadata">{runLabel(run.label)}</span>
									<CodeBlock>{run.text}</CodeBlock>
								</li>
							))}
						</ul>
					)}
				</section>
			))}
			{hasMcpValueCommands(reviews) ? <CommandSpeedHint /> : null}
		</div>
	);
}

function ValueRows({
	draft,
	onChange,
}: {
	draft: McpFormDraft;
	onChange: (draft: McpFormDraft) => void;
}) {
	const http = draft.transport === "http";
	const update = (id: string, patch: { name?: string; value?: string }) =>
		onChange({
			...draft,
			values: draft.values.map((row) => (row.id === id ? { ...row, ...patch } : row)),
		});
	return (
		<div className="flex flex-col gap-4">
			{draft.values.map((row) => (
				<div key={row.id} className="flex items-center gap-4" data-testid="mcp-form-value">
					<input
						aria-label={http ? "Header name" : "Variable name"}
						data-testid="mcp-form-value-name"
						placeholder={http ? "Authorization" : "API_KEY"}
						value={row.name}
						onChange={(event) => update(row.id, { name: event.currentTarget.value })}
						className={cn(MCP_INPUT_CLASS, "w-[40%] tr-code-text")}
					/>
					<input
						aria-label={http ? "Header value" : "Variable value"}
						data-testid="mcp-form-value-value"
						placeholder={http ? `Bearer \${TOKEN}` : `\${API_KEY}`}
						value={row.value}
						onChange={(event) => update(row.id, { value: event.currentTarget.value })}
						className={cn(MCP_INPUT_CLASS, "flex-1 tr-code-text")}
					/>
					<Button
						variant="ghost"
						size="icon"
						aria-label="Remove"
						onClick={() =>
							onChange({ ...draft, values: draft.values.filter((other) => other.id !== row.id) })
						}
					>
						<Trash2 className="size-14" />
					</Button>
				</div>
			))}
			<Button
				variant="ghost"
				size="sm"
				data-testid="mcp-form-add-value"
				className="self-start"
				onClick={() =>
					onChange({
						...draft,
						values: [...draft.values, { id: randomId("v"), name: "", value: "" }],
					})
				}
			>
				<Plus className="size-14" />
				{http ? "Add header" : "Add variable"}
			</Button>
		</div>
	);
}

function McpForm({
	draft,
	issues,
	warnings,
	onChange,
}: {
	draft: McpFormDraft;
	issues: ReturnType<typeof validateMcpDraft> | null;
	warnings: string[];
	onChange: (draft: McpFormDraft) => void;
}) {
	return (
		<div className="flex flex-col gap-12" data-testid="mcp-add-form">
			<Field label="Name" error={issues?.name} hint="Letters, digits, - and _.">
				<input
					data-testid="mcp-form-name"
					value={draft.name}
					placeholder="docs"
					onChange={(event) => onChange({ ...draft, name: event.currentTarget.value })}
					className={MCP_INPUT_CLASS}
				/>
			</Field>
			<Field label="Transport">
				<Segments
					testId="mcp-form-transport"
					value={draft.transport}
					options={[
						{ id: "stdio", label: "stdio command" },
						{ id: "http", label: "HTTP URL" },
					]}
					onChange={(transport) => onChange({ ...draft, transport })}
				/>
			</Field>
			{draft.transport === "http" ? (
				<Field label="URL" error={issues?.url} hint="The server's streamable HTTP endpoint.">
					<input
						data-testid="mcp-form-url"
						value={draft.url}
						placeholder="https://example.com/mcp"
						onChange={(event) => onChange({ ...draft, url: event.currentTarget.value })}
						className={cn(MCP_INPUT_CLASS, "tr-code-text")}
					/>
				</Field>
			) : (
				<>
					<Field
						label="Command"
						error={issues?.command}
						hint="One executable; it runs on the host and inherits the host environment."
					>
						<input
							data-testid="mcp-form-command"
							value={draft.command}
							placeholder="npx"
							onChange={(event) => onChange({ ...draft, command: event.currentTarget.value })}
							className={cn(MCP_INPUT_CLASS, "tr-code-text")}
						/>
					</Field>
					<Field label="Arguments" hint="One per line — never split by a shell.">
						<Textarea
							data-testid="mcp-form-args"
							rows={3}
							value={draft.args}
							placeholder={"-y\n@modelcontextprotocol/server-filesystem\n."}
							onChange={(event) => onChange({ ...draft, args: event.currentTarget.value })}
							className="px-8 py-4 tr-code-text"
						/>
					</Field>
				</>
			)}
			<Field
				label={draft.transport === "http" ? "Headers" : "Environment"}
				error={issues?.values}
				hint={
					<>
						Each value is a <code className="tr-code-text">{NAME_REFERENCE}</code> reference to the
						host environment or a <code className="tr-code-text">!command</code> whose output is the
						value — plain values are never saved.
					</>
				}
			>
				<ValueRows draft={draft} onChange={onChange} />
			</Field>
			<Field label="Exposure" hint={MCP_EXPOSURE_HINT[draft.exposure]}>
				<Segments
					testId="mcp-form-exposure"
					value={draft.exposure}
					options={MCP_EXPOSURES.map((id) => ({ id, label: mcpExposureLabel(id) }))}
					onChange={(exposure) => onChange({ ...draft, exposure })}
				/>
			</Field>
			<Field label="Description" hint="Optional — helps the model and tool search find it.">
				<input
					data-testid="mcp-form-description"
					value={draft.description}
					onChange={(event) => onChange({ ...draft, description: event.currentTarget.value })}
					className={MCP_INPUT_CLASS}
				/>
			</Field>
			{warnings.map((warning) => (
				<p key={warning} className="text-feedback-warning tr-text-metadata">
					{warning}
				</p>
			))}
		</div>
	);
}

function McpImport({
	text,
	scope,
	existing,
	onChange,
}: {
	text: string;
	scope: McpServerScope;
	existing: readonly McpServerSummary[];
	onChange: (text: string) => void;
}) {
	const parsed = text.trim() ? parseMcpServersJson(text) : null;
	const names = parsed?.ok ? parsed.servers.map((server) => server.name) : [];
	return (
		<div className="flex flex-col gap-12" data-testid="mcp-add-json">
			<Field
				label="mcpServers JSON"
				hint='Paste one or many servers — { "mcpServers": { … } } or just the map, as other MCP clients write it.'
			>
				<Textarea
					data-testid="mcp-json-input"
					rows={8}
					value={text}
					placeholder={
						'{\n  "mcpServers": {\n    "docs": { "url": "https://example.com/mcp" }\n  }\n}'
					}
					onChange={(event) => onChange(event.currentTarget.value)}
					className="px-8 py-4 tr-code-text"
				/>
			</Field>
			{parsed && !parsed.ok ? (
				<p
					role="alert"
					data-testid="mcp-json-error"
					className="text-feedback-error tr-text-metadata"
				>
					{parsed.error}
				</p>
			) : null}
			{parsed?.ok ? (
				<ul className="flex flex-col gap-4" data-testid="mcp-json-preview">
					{parsed.servers.map((server) => {
						const issues = importIssues(server, scope, existing, names);
						const facts = mcpApprovalFacts(server.entry);
						const values = [...facts.env, ...facts.headers].map((fact) => fact.name);
						return (
							<li
								key={server.name}
								data-testid="mcp-json-server"
								data-name={server.name}
								data-valid={issues.length === 0}
								className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-border-default px-8 py-4"
							>
								<span className="flex min-w-0 items-center gap-8">
									<span className="truncate tr-title-compact text-text-default">{server.name}</span>
									<span className="truncate text-text-muted tr-code-text-small">
										{mcpEndpointOf(server.entry)}
									</span>
								</span>
								{values.length > 0 ? (
									<span className="text-text-muted tr-text-metadata">
										{typeof server.entry.url === "string" ? "Headers" : "Environment"}:{" "}
										{values.join(", ")}
									</span>
								) : null}
								{issues.map((issue) => (
									<span key={issue} className="text-feedback-error tr-text-metadata">
										{issue}
									</span>
								))}
							</li>
						);
					})}
				</ul>
			) : null}
		</div>
	);
}

function PresetList({
	presets,
	existing,
	disabled,
	onAdd,
}: {
	presets: readonly McpPreset[];
	existing: readonly McpServerSummary[];
	disabled: boolean;
	onAdd: (preset: McpPreset) => void;
}) {
	return (
		<section className="flex flex-col gap-8" data-testid="mcp-presets">
			<h4 className="tr-text-eyebrow text-text-muted">Presets</h4>
			<ul className="flex flex-col gap-4">
				{presets.map((preset) => (
					<li
						key={preset.id}
						data-testid="mcp-preset"
						data-preset={preset.id}
						className="flex items-center gap-8 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8"
					>
						<span className="flex min-w-0 flex-1 flex-col gap-2">
							<span className="tr-title-compact text-text-default">{preset.title}</span>
							<span className="text-text-muted tr-text-metadata">{preset.description}</span>
						</span>
						<Button
							variant="outline"
							size="sm"
							data-testid="mcp-preset-add"
							disabled={disabled || existing.some((server) => server.name === preset.name)}
							onClick={() => onAdd(preset)}
						>
							<Plus className="size-14" />
							{existing.some((server) => server.name === preset.name) ? "Added" : "Add"}
						</Button>
					</li>
				))}
			</ul>
		</section>
	);
}

function GithubRecipe({
	added,
	disabled,
	onUse,
}: {
	added: boolean;
	disabled: boolean;
	onUse: () => void;
}) {
	return (
		<div
			data-testid="mcp-github-recipe"
			className="flex items-center gap-8 rounded-[var(--radius-sm)] border border-border-default px-12 py-8"
		>
			<span className="flex min-w-0 flex-1 flex-col gap-2">
				<span className="tr-title-compact text-text-default">GitHub (read-only)</span>
				<span className="text-text-muted tr-text-metadata">
					Not a preset: a recipe for Paste JSON that sends your GitHub CLI token (
					<code className="tr-code-text">gh auth token</code>) and fails while gh is logged out.
				</span>
			</span>
			<Button
				variant="outline"
				size="sm"
				data-testid="mcp-github-recipe-use"
				disabled={disabled || added}
				onClick={onUse}
			>
				{added ? "Added" : "Use recipe"}
			</Button>
		</div>
	);
}

type AddStep =
	| { kind: "edit" }
	| {
			kind: "review";
			servers: { name: string; entry: McpServerEntryInput }[];
			reviews: McpServerReview[];
			scope: McpServerScope;
			modifiesData?: string;
			optInPerProject?: boolean;
			from: "form" | "json" | "preset";
	  };

function presetStep(preset: McpPreset): AddStep {
	return {
		kind: "review",
		servers: [{ name: preset.name, entry: preset.entry }],
		reviews: [reviewMcpServer(preset.name, preset.entry)],
		scope: preset.scope,
		from: "preset",
		...(preset.modifiesData ? { modifiesData: preset.modifiesData } : {}),
		...(preset.optInPerProject ? { optInPerProject: true } : {}),
	};
}

export function McpAddDialog({
	open,
	initialTier,
	initialPreset,
	existing,
	projectScopeAvailable,
	onOpenChange,
	onAdd,
	onEnableInProject,
}: {
	open: boolean;
	initialTier: "form" | "json";
	initialPreset?: McpPreset | undefined;
	existing: readonly McpServerSummary[];
	projectScopeAvailable: boolean;
	onOpenChange: (open: boolean) => void;
	onAdd: McpAddServers;
	onEnableInProject: (name: string) => Promise<string | null>;
}) {
	const [tier, setTier] = useState(initialTier);
	const [selectedScope, setSelectedScope] = useState<McpServerScope>("user");
	const scope: McpServerScope = projectScopeAvailable ? selectedScope : "user";
	const [draft, setDraft] = useState<McpFormDraft>(emptyMcpDraft);
	const [submitted, setSubmitted] = useState(false);
	const [json, setJson] = useState("");
	const [step, setStep] = useState<AddStep>(() =>
		initialPreset ? presetStep(initialPreset) : { kind: "edit" },
	);
	const [saving, setSaving] = useState(false);
	const [failures, setFailures] = useState<McpAddResult[]>([]);
	useEffect(() => {
		if (projectScopeAvailable) return;
		setStep((current) =>
			current.kind === "review" && current.scope === "project" ? { kind: "edit" } : current,
		);
	}, [projectScopeAvailable]);

	const issues = validateMcpDraft(draft, scope, existing);
	const warnings = [
		...mcpDraftWarnings(draft),
		...[mcpNameWarning(draft.name.trim(), scope, existing)].filter(
			(warning): warning is string => !!warning,
		),
	];
	const parsed = json.trim() ? parseMcpServersJson(json) : null;
	const parsedServers = parsed?.ok ? parsed.servers : [];
	const importable = parsedServers.filter(
		(server) =>
			importIssues(
				server,
				scope,
				existing,
				parsedServers.map((other) => other.name),
			).length === 0,
	);

	const save = async (
		servers: { name: string; entry: McpServerEntryInput }[],
		targetScope: McpServerScope,
		from: "form" | "json" | "preset",
		optInPerProject = false,
	) => {
		setSaving(true);
		const added = await onAdd(servers, targetScope);
		const results = optInPerProject
			? await Promise.all(
					added.map(async (result) =>
						result.error === null
							? { name: result.name, error: await onEnableInProject(result.name) }
							: result,
					),
				)
			: added;
		setSaving(false);
		const failed = results.filter((result) => result.error !== null);
		setFailures(failed);
		if (failed.length === 0) {
			onOpenChange(false);
			return;
		}
		setStep({ kind: "edit" });
		if (from === "json") {
			const remaining = Object.fromEntries(
				servers
					.filter((server) => failed.some((result) => result.name === server.name))
					.map((server) => [server.name, server.entry]),
			);
			setJson(JSON.stringify({ mcpServers: remaining }, null, 2));
		}
	};

	const proceed = (
		servers: { name: string; entry: McpServerEntryInput }[],
		from: "form" | "json",
	) => {
		setFailures([]);
		const reviews = servers.map((server) => reviewMcpServer(server.name, server.entry));
		if (needsMcpReview(reviews)) setStep({ kind: "review", servers, reviews, scope, from });
		else void save(servers, scope, from);
	};

	const submitForm = () => {
		setSubmitted(true);
		if (Object.keys(issues).length > 0) return;
		proceed([{ name: draft.name.trim(), entry: buildMcpEntry(draft) }], "form");
	};

	const addPreset = (preset: McpPreset) => {
		setFailures([]);
		setStep(presetStep(preset));
	};

	const reviewing = step.kind === "review";
	return (
		<Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
			<DialogContent
				data-testid="mcp-add-dialog"
				className="flex max-h-[85vh] max-w-[36rem] flex-col"
			>
				<DialogHeader>
					<DialogTitle>{reviewing ? "Confirm what will run" : "Add MCP servers"}</DialogTitle>
					<DialogDescription>
						{reviewing
							? "Saving lets chats in scope run these on this host and stores the entry as shown."
							: "Servers run on the host that runs ThinkRail and inherit its environment."}
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					{step.kind === "review" ? (
						<McpRunReview reviews={step.reviews} modifiesData={step.modifiesData} />
					) : (
						<div className="flex flex-col gap-16">
							{MCP_PRESETS.length > 0 ? (
								<PresetList
									presets={MCP_PRESETS}
									existing={existing}
									disabled={saving}
									onAdd={addPreset}
								/>
							) : null}
							<GithubRecipe
								added={existing.some((server) => server.name === "github")}
								disabled={saving}
								onUse={() => {
									setTier("json");
									setJson(GITHUB_MCP_RECIPE_JSON);
								}}
							/>
							<div className="flex flex-wrap items-center justify-between gap-8">
								<Segments
									testId="mcp-add-tier"
									value={tier}
									options={[
										{ id: "form", label: "Form" },
										{ id: "json", label: "Paste JSON" },
									]}
									onChange={setTier}
								/>
								<Segments
									testId="mcp-add-scope"
									value={scope}
									options={[
										{ id: "user", label: "User — all projects" },
										{
											id: "project",
											label: "Project — .pi/mcp.json",
											disabled: !projectScopeAvailable,
										},
									]}
									onChange={setSelectedScope}
								/>
							</div>
							{!projectScopeAvailable ? (
								<p className="text-text-muted tr-text-metadata">
									Project servers load only after you trust this project.
								</p>
							) : null}
							{tier === "form" ? (
								<McpForm
									draft={draft}
									issues={submitted ? issues : null}
									warnings={warnings}
									onChange={setDraft}
								/>
							) : (
								<McpImport text={json} scope={scope} existing={existing} onChange={setJson} />
							)}
						</div>
					)}
					{failures.length > 0 ? (
						<ul role="alert" data-testid="mcp-add-errors" className="flex flex-col gap-2">
							{failures.map((failure) => (
								<li key={failure.name} className="text-feedback-error tr-text-metadata">
									{failure.name}: {failure.error}
								</li>
							))}
						</ul>
					) : null}
				</DialogBody>
				<DialogFooter>
					{step.kind === "review" ? (
						<>
							<Button variant="outline" disabled={saving} onClick={() => setStep({ kind: "edit" })}>
								Back
							</Button>
							<Button
								data-testid="mcp-add-confirm"
								disabled={saving}
								onClick={() => void save(step.servers, step.scope, step.from, step.optInPerProject)}
							>
								{step.servers.length > 1 ? "Add servers" : "Add server"}
							</Button>
						</>
					) : (
						<>
							<Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
								Cancel
							</Button>
							{tier === "form" ? (
								<Button data-testid="mcp-add-submit" disabled={saving} onClick={submitForm}>
									Add server
								</Button>
							) : (
								<Button
									data-testid="mcp-add-submit"
									disabled={saving || importable.length === 0}
									onClick={() =>
										proceed(
											importable.map((server) => ({ name: server.name, entry: server.entry })),
											"json",
										)
									}
								>
									{importable.length < parsedServers.length
										? `Add ${importable.length} of ${parsedServers.length} servers`
										: importable.length > 1
											? `Add ${importable.length} servers`
											: "Add server"}
								</Button>
							)}
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export interface McpEditTarget {
	summary: McpServerSummary;
	entry: McpServerEntryInput;
}

function editErrors(
	text: string,
	written: McpServerEntryInput,
): { entry: McpServerEntryInput | null; errors: string[] } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		return {
			entry: null,
			errors: [`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`],
		};
	}
	const errors = mcpEntryErrors(parsed);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return { entry: null, errors };
	}
	const edited = mcpEditedEntry(parsed as McpServerEntryInput, written);
	return { entry: edited.entry, errors: [...errors, ...edited.issues] };
}

export function McpEditDialog({
	target,
	onClose,
	onSave,
}: {
	target: McpEditTarget;
	onClose: () => void;
	onSave: (entry: McpServerEntryInput) => Promise<string | null>;
}) {
	const shown = useMemo(
		() => JSON.stringify(hideMcpLiterals(target.entry), null, 2),
		[target.entry],
	);
	const [text, setText] = useState(shown);
	const [review, setReview] = useState<{
		entry: McpServerEntryInput;
		reviews: McpServerReview[];
	} | null>(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { entry, errors } = editErrors(text, target.entry);
	const { name } = target.summary;

	const commit = async (next: McpServerEntryInput) => {
		setSaving(true);
		setError(null);
		const failure = await onSave(next);
		setSaving(false);
		if (failure) {
			setError(failure);
			setReview(null);
		} else onClose();
	};
	const submit = () => {
		if (!entry || errors.length > 0) return;
		const reviews = [reviewMcpServer(name, entry)];
		if (needsMcpReview(reviews)) setReview({ entry, reviews });
		else void commit(entry);
	};

	return (
		<Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
			<DialogContent
				data-testid="mcp-edit-dialog"
				className="flex max-h-[85vh] max-w-[36rem] flex-col"
			>
				<DialogHeader>
					<DialogTitle>{review ? "Confirm what will run" : `Edit ${name}`}</DialogTitle>
					<DialogDescription>
						Saving rewrites this entry in the repository's .pi/mcp.json.
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					{review ? (
						<McpRunReview reviews={review.reviews} />
					) : (
						<div className="flex flex-col gap-8">
							{shown.includes(MCP_HIDDEN_VALUE) ? (
								<p data-testid="mcp-edit-hidden" className="text-text-muted tr-text-metadata">
									Plain values show as <code className="tr-code-text">{MCP_HIDDEN_VALUE}</code>.
									Leave one in place to keep the file's value, or replace it with a{" "}
									<code className="tr-code-text">{NAME_REFERENCE}</code> reference or a{" "}
									<code className="tr-code-text">!command</code>.
								</p>
							) : null}
							<Textarea
								data-testid="mcp-edit-input"
								rows={12}
								value={text}
								onChange={(event) => setText(event.currentTarget.value)}
								className="px-8 py-4 tr-code-text"
							/>
							{errors.map((message) => (
								<p key={message} role="alert" className="text-feedback-error tr-text-metadata">
									{message}
								</p>
							))}
						</div>
					)}
					{error ? (
						<p role="alert" className="text-feedback-error tr-text-metadata">
							{error}
						</p>
					) : null}
				</DialogBody>
				<DialogFooter>
					{review ? (
						<>
							<Button variant="outline" disabled={saving} onClick={() => setReview(null)}>
								Back
							</Button>
							<Button
								data-testid="mcp-edit-confirm"
								disabled={saving}
								onClick={() => void commit(review.entry)}
							>
								Save
							</Button>
						</>
					) : (
						<>
							<Button variant="outline" disabled={saving} onClick={onClose}>
								Cancel
							</Button>
							<Button
								data-testid="mcp-edit-save"
								disabled={saving || !entry || errors.length > 0}
								onClick={submit}
							>
								Save
							</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function FactRow({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex flex-col gap-2">
			<dt className="text-text-muted tr-text-metadata">{label}</dt>
			<dd className="min-w-0 text-text-default tr-text-ui">{children}</dd>
		</div>
	);
}

export interface McpApproveTarget {
	summary: McpServerSummary;
	entry: McpServerEntryInput | null;
	readError: string | null;
}

export function McpApproveDialog({
	target,
	onClose,
	onApprove,
}: {
	target: McpApproveTarget;
	onClose: () => void;
	onApprove: () => Promise<string | null>;
}) {
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { summary, entry } = target;
	const facts = entry ? mcpApprovalFacts(entry) : null;
	const approve = async () => {
		setSaving(true);
		setError(null);
		const failure = await onApprove();
		setSaving(false);
		if (failure) setError(failure);
		else onClose();
	};
	return (
		<Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
			<DialogContent
				data-testid="mcp-approve-dialog"
				className="flex max-h-[85vh] max-w-[32rem] flex-col"
			>
				<DialogHeader>
					<DialogTitle>Review {summary.name}</DialogTitle>
					<DialogDescription>
						{summary.approval?.state === "changed"
							? "This repository entry changed since you approved it. Approve it again to let chats use it."
							: "This repository defines the server in .pi/mcp.json. Approve it to let chats in this project start it."}
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					{target.readError ? (
						<p role="alert" className="text-feedback-error tr-text-ui">
							{target.readError}
						</p>
					) : facts ? (
						<dl className="flex flex-col gap-12" data-testid="mcp-approve-facts">
							{summary.replacesGlobal ? (
								<p className="text-feedback-warning tr-text-ui">
									It replaces your user-level {summary.name} in this project.
								</p>
							) : null}
							{facts.overrides.length > 0 ? (
								<FactRow label="Changes your user-level server's settings">
									<CodeBlock>{facts.overrides.join("\n")}</CodeBlock>
								</FactRow>
							) : null}
							{facts.defines === "command" ? (
								<FactRow label={runLabel("command")}>
									<CodeBlock testId="mcp-approve-run">{summary.endpoint}</CodeBlock>
								</FactRow>
							) : null}
							{facts.runs.map((run) => (
								<FactRow key={`${run.label}:${run.text}`} label={runLabel(run.label)}>
									<CodeBlock testId="mcp-approve-run">{run.text}</CodeBlock>
								</FactRow>
							))}
							{facts.defines === "url" ? (
								<FactRow label="Connects to">
									<CodeBlock>{summary.endpoint}</CodeBlock>
								</FactRow>
							) : null}
							{facts.cwd ? (
								<FactRow label="Working directory">
									<CodeBlock>{facts.cwd}</CodeBlock>
								</FactRow>
							) : null}
							{facts.env.length > 0 ? (
								<FactRow label="Environment variables">
									<CodeBlock testId="mcp-approve-env">
										{facts.env.map((fact) => `${fact.name}=${fact.value}`).join("\n")}
									</CodeBlock>
								</FactRow>
							) : null}
							{facts.headers.length > 0 ? (
								<FactRow label="Headers">
									<CodeBlock testId="mcp-approve-headers">
										{facts.headers.map((fact) => `${fact.name}: ${fact.value}`).join("\n")}
									</CodeBlock>
								</FactRow>
							) : null}
						</dl>
					) : null}
					{(facts?.runs.length ?? 0) > 0 ? <CommandSpeedHint /> : null}
					{error ? (
						<p role="alert" className="text-feedback-error tr-text-ui">
							{error}
						</p>
					) : null}
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" disabled={saving} onClick={onClose}>
						Cancel
					</Button>
					<Button
						data-testid="mcp-approve-confirm"
						disabled={saving || !facts || !summary.approval}
						onClick={() => void approve()}
					>
						Approve
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function McpDetailsDialog({
	row,
	view,
	onClose,
}: {
	row: McpServerRow;
	view: McpRowView;
	onClose: () => void;
}) {
	const { summary } = row;
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				data-testid="mcp-details-dialog"
				className="flex max-h-[85vh] max-w-[34rem] flex-col"
			>
				<DialogHeader>
					<DialogTitle>{summary.name}</DialogTitle>
					{summary.description ? (
						<DialogDescription>{summary.description}</DialogDescription>
					) : null}
				</DialogHeader>
				<DialogBody>
					<dl className="flex flex-col gap-12">
						<FactRow label="Status">
							{view.label}
							{view.reason ? ` — ${view.reason}` : ""}
						</FactRow>
						<FactRow label={summary.transport === "http" ? "URL" : "Command"}>
							<CodeBlock testId="mcp-details-endpoint">{summary.endpoint}</CodeBlock>
						</FactRow>
						<FactRow label="Defined in">
							<CodeBlock>{summary.source}</CodeBlock>
						</FactRow>
						<FactRow label="Scope">
							{SCOPE_LABEL[summary.scope]}
							{summary.replacesGlobal ? " — replaces your user-level server here" : ""}
						</FactRow>
						<FactRow label="Effective exposure">
							<span data-testid="mcp-details-exposure">
								{mcpExposureLabel(summary.effectiveExposure)}
							</span>
						</FactRow>
						{summary.exposure !== summary.effectiveExposure ? (
							<FactRow label="Configured exposure">{mcpConfiguredExposureText(summary)}</FactRow>
						) : null}
						{summary.projectOverride ? (
							<FactRow label="This project's setting">
								{[
									summary.projectOverride.enabled === undefined
										? null
										: summary.projectOverride.enabled
											? "enabled"
											: "disabled",
									summary.projectOverride.exposure ?? null,
								]
									.filter(Boolean)
									.join(", ")}
							</FactRow>
						) : null}
						{row.sessions.total > 0 ? (
							<FactRow label="Live chats">
								{row.sessions.total} · connected in {row.sessions.connected}
							</FactRow>
						) : null}
						{summary.configError ? (
							<FactRow label="Config error">
								<CodeBlock>{summary.configError}</CodeBlock>
							</FactRow>
						) : null}
						{row.detail && row.detail !== summary.configError ? (
							<FactRow label="Last report from pi">
								<CodeBlock testId="mcp-details-detail">{row.detail}</CodeBlock>
							</FactRow>
						) : null}
					</dl>
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export type McpLogRead =
	| { state: "reading" }
	| { state: "read"; log: McpServerLog }
	| { state: "failed"; error: string };

export function McpLogDialog({
	row,
	read,
	onClose,
}: {
	row: McpServerRow;
	read: McpLogRead;
	onClose: () => void;
}) {
	const { name } = row.summary;
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				data-testid="mcp-log-dialog"
				className="flex max-h-[85vh] max-w-[40rem] flex-col"
			>
				<DialogHeader>
					<DialogTitle>{name} log</DialogTitle>
					<DialogDescription>
						What pi last reported for this server, and the messages the server sent pi.
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					<dl className="flex flex-col gap-12">
						{row.detail ? (
							<FactRow label="Last report from pi">
								<CodeBlock testId="mcp-log-report">{row.detail}</CodeBlock>
							</FactRow>
						) : null}
						<FactRow label="Server messages">
							{read.state === "reading" ? (
								<span className="text-text-muted tr-text-metadata">Reading the log…</span>
							) : read.state === "failed" ? (
								<span role="alert" className="text-feedback-error tr-text-metadata">
									{read.error}
								</span>
							) : (
								<span className="flex flex-col gap-4">
									<span className="break-all text-text-muted tr-text-metadata">
										{read.log.path}
									</span>
									{read.log.text ? (
										<CodeBlock testId="mcp-log-text">{read.log.text}</CodeBlock>
									) : (
										<span data-testid="mcp-log-empty" className="text-text-muted tr-text-metadata">
											{name} has sent pi no log messages.
										</span>
									)}
								</span>
							)}
						</FactRow>
					</dl>
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
