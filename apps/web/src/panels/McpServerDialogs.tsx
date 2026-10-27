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
import type { MessageKey } from "@thinkrail/locales";
import { T, type Translator, useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { Textarea } from "@thinkrail/ui/textarea";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
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

const MCP_INPUT_CLASS =
	"w-full min-w-0 rounded-sm border border-control-border-default bg-control-bg px-8 py-4 tr-text-ui text-text-default outline-none placeholder:text-text-muted focus-visible:border-control-border-active disabled:border-control-disabled-border disabled:bg-control-disabled-bg disabled:text-control-disabled-text";

const NAME_REFERENCE = `\${NAME}`;

const PLACEHOLDER = {
	name: "docs",
	url: "https://example.com/mcp",
	command: "npx",
	args: "-y\n@modelcontextprotocol/server-filesystem\n.",
	headerName: "Authorization",
	headerValue: `Bearer \${TOKEN}`,
	variableName: "API_KEY",
	variableValue: `\${API_KEY}`,
	json: '{\n  "mcpServers": {\n    "docs": { "url": "https://example.com/mcp" }\n  }\n}',
} as const;

function CodeBlock({ testId, children }: { testId?: string; children: ReactNode }) {
	return (
		<code
			data-testid={testId}
			className="block whitespace-pre-wrap break-words rounded-sm bg-control-bg px-8 py-4 tr-code-text text-text-default"
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

export async function addMcpServersWithProjectOptIn(
	servers: { name: string; entry: McpServerEntryInput }[],
	scope: McpServerScope,
	onAdd: McpAddServers,
	onEnableInProject?: (name: string) => Promise<void>,
): Promise<McpAddResult[]> {
	const added = await onAdd(servers, scope);
	if (onEnableInProject) {
		await Promise.allSettled(
			added
				.filter((result) => result.error === null)
				.map(async (result) => onEnableInProject(result.name)),
		);
	}
	return added;
}

function DialogBody({ children }: { children: ReactNode }) {
	return (
		<div className="-mx-16 flex min-h-0 flex-1 flex-col gap-12 overflow-y-auto px-16">
			{children}
		</div>
	);
}

function runLabel(t: Translator, label: string): string {
	return label === "command" ? t("mcp.run.onHost") : t("mcp.run.fills", { label });
}

function CommandSpeedHint() {
	return (
		<p data-testid="mcp-command-hint" className="text-text-muted tr-text-metadata">
			<T
				i18nKey="mcp.run.speedHint"
				components={[<code key="command" className="tr-code-text" />]}
			/>
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
	const t = useT();
	return (
		<div data-testid="mcp-run-review" className="flex flex-col gap-12">
			{modifiesData ? (
				<p className="flex items-start gap-8 text-feedback-warning tr-text-ui">
					<TriangleAlert className="mt-2 size-14 shrink-0" />
					{t("mcp.review.modifiesData", { target: modifiesData })}
				</p>
			) : null}
			{reviews.map((review) => (
				<section key={review.name} className="flex flex-col gap-4" data-testid="mcp-run-server">
					<h4 className="tr-title-compact text-text-default">{review.name}</h4>
					{review.runs.length === 0 ? (
						<p className="text-text-muted tr-text-metadata">{t("mcp.review.nothingRuns")}</p>
					) : (
						<ul className="flex flex-col gap-4">
							{review.runs.map((run) => (
								<li
									key={`${run.label}:${run.text}`}
									data-testid="mcp-run-item"
									className="flex flex-col gap-2"
								>
									<span className="text-text-muted tr-text-metadata">{runLabel(t, run.label)}</span>
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
	const t = useT();
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
						aria-label={http ? t("mcp.form.headerName") : t("mcp.form.variableName")}
						data-testid="mcp-form-value-name"
						placeholder={http ? PLACEHOLDER.headerName : PLACEHOLDER.variableName}
						value={row.name}
						onChange={(event) => update(row.id, { name: event.currentTarget.value })}
						className={cn(MCP_INPUT_CLASS, "w-[40%] tr-code-text")}
					/>
					<input
						aria-label={http ? t("mcp.form.headerValue") : t("mcp.form.variableValue")}
						data-testid="mcp-form-value-value"
						placeholder={http ? PLACEHOLDER.headerValue : PLACEHOLDER.variableValue}
						value={row.value}
						onChange={(event) => update(row.id, { value: event.currentTarget.value })}
						className={cn(MCP_INPUT_CLASS, "flex-1 tr-code-text")}
					/>
					<IconButton
						icon={Trash2}
						label={t("common.remove")}
						onClick={() =>
							onChange({ ...draft, values: draft.values.filter((other) => other.id !== row.id) })
						}
					/>
				</div>
			))}
			<Button
				variant="ghost"
				size="m"
				iconLeft={Plus}
				data-testid="mcp-form-add-value"
				className="self-start"
				onClick={() =>
					onChange({
						...draft,
						values: [...draft.values, { id: randomId("v"), name: "", value: "" }],
					})
				}
			>
				{http ? t("mcp.form.addHeader") : t("mcp.form.addVariable")}
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
	const t = useT();
	return (
		<div className="flex flex-col gap-12" data-testid="mcp-add-form">
			<Field label={t("mcp.form.name")} error={issues?.name} hint={t("mcp.form.nameHint")}>
				<input
					data-testid="mcp-form-name"
					value={draft.name}
					placeholder={PLACEHOLDER.name}
					onChange={(event) => onChange({ ...draft, name: event.currentTarget.value })}
					className={MCP_INPUT_CLASS}
				/>
			</Field>
			<Field label={t("mcp.form.transport")}>
				<Segments
					testId="mcp-form-transport"
					value={draft.transport}
					options={[
						{ id: "stdio", label: t("mcp.form.transportStdio") },
						{ id: "http", label: t("mcp.form.transportHttp") },
					]}
					onChange={(transport) => onChange({ ...draft, transport })}
				/>
			</Field>
			{draft.transport === "http" ? (
				<Field label={t("mcp.form.url")} error={issues?.url} hint={t("mcp.form.urlHint")}>
					<input
						data-testid="mcp-form-url"
						value={draft.url}
						placeholder={PLACEHOLDER.url}
						onChange={(event) => onChange({ ...draft, url: event.currentTarget.value })}
						className={cn(MCP_INPUT_CLASS, "tr-code-text")}
					/>
				</Field>
			) : (
				<>
					<Field
						label={t("mcp.form.command")}
						error={issues?.command}
						hint={t("mcp.form.commandHint")}
					>
						<input
							data-testid="mcp-form-command"
							value={draft.command}
							placeholder={PLACEHOLDER.command}
							onChange={(event) => onChange({ ...draft, command: event.currentTarget.value })}
							className={cn(MCP_INPUT_CLASS, "tr-code-text")}
						/>
					</Field>
					<Field label={t("mcp.form.args")} hint={t("mcp.form.argsHint")}>
						<Textarea
							data-testid="mcp-form-args"
							rows={3}
							value={draft.args}
							placeholder={PLACEHOLDER.args}
							onChange={(event) => onChange({ ...draft, args: event.currentTarget.value })}
							className="px-8 py-4 tr-code-text"
						/>
					</Field>
				</>
			)}
			<Field
				label={draft.transport === "http" ? t("mcp.form.headers") : t("mcp.form.environment")}
				error={issues?.values}
				hint={
					<T
						i18nKey="mcp.form.valuesHint"
						values={{ reference: NAME_REFERENCE }}
						components={[
							<code key="reference" className="tr-code-text" />,
							<code key="command" className="tr-code-text" />,
						]}
					/>
				}
			>
				<ValueRows draft={draft} onChange={onChange} />
			</Field>
			<Field label={t("mcp.form.exposure")} hint={t(MCP_EXPOSURE_HINT[draft.exposure])}>
				<Segments
					testId="mcp-form-exposure"
					value={draft.exposure}
					options={MCP_EXPOSURES.map((id) => ({ id, label: mcpExposureLabel(t, id) }))}
					onChange={(exposure) => onChange({ ...draft, exposure })}
				/>
			</Field>
			<Field label={t("mcp.form.description")} hint={t("mcp.form.descriptionHint")}>
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
	const t = useT();
	const parsed = text.trim() ? parseMcpServersJson(t, text) : null;
	const names = parsed?.ok ? parsed.servers.map((server) => server.name) : [];
	return (
		<div className="flex flex-col gap-12" data-testid="mcp-add-json">
			<Field label={t("mcp.import.label")} hint={t("mcp.import.hint")}>
				<Textarea
					data-testid="mcp-json-input"
					rows={8}
					value={text}
					placeholder={PLACEHOLDER.json}
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
						const issues = importIssues(t, server, scope, existing, names);
						const facts = mcpApprovalFacts(server.entry);
						const values = [...facts.env, ...facts.headers].map((fact) => fact.name);
						return (
							<li
								key={server.name}
								data-testid="mcp-json-server"
								data-name={server.name}
								data-valid={issues.length === 0}
								className="flex flex-col gap-2 rounded-sm border border-border-default px-8 py-4"
							>
								<span className="flex min-w-0 items-center gap-8">
									<span className="truncate tr-title-compact text-text-default">{server.name}</span>
									<span className="truncate text-text-muted tr-code-text-small">
										{mcpEndpointOf(server.entry)}
									</span>
								</span>
								{values.length > 0 ? (
									<span className="text-text-muted tr-text-metadata">
										{typeof server.entry.url === "string"
											? t("mcp.import.headers", { names: values.join(", ") })
											: t("mcp.import.environment", { names: values.join(", ") })}
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
	const t = useT();
	return (
		<section className="flex flex-col gap-8" data-testid="mcp-presets">
			<h4 className="tr-text-eyebrow text-text-muted">{t("mcp.presets.title")}</h4>
			<ul className="flex flex-col gap-4">
				{presets.map((preset) => (
					<li
						key={preset.id}
						data-testid="mcp-preset"
						data-preset={preset.id}
						className="flex items-center gap-8 rounded-sm border border-border-default bg-control-bg px-12 py-8"
					>
						<span className="flex min-w-0 flex-1 flex-col gap-2">
							<span className="tr-title-compact text-text-default">{t(preset.title)}</span>
							<span className="text-text-muted tr-text-metadata">{t(preset.description)}</span>
						</span>
						<Button
							variant="outline"
							size="m"
							iconLeft={Plus}
							data-testid="mcp-preset-add"
							disabled={disabled || existing.some((server) => server.name === preset.name)}
							onClick={() => onAdd(preset)}
						>
							{existing.some((server) => server.name === preset.name)
								? t("mcp.presets.added")
								: t("common.add")}
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
	const t = useT();
	return (
		<div
			data-testid="mcp-github-recipe"
			className="flex items-center gap-8 rounded-sm border border-border-default px-12 py-8"
		>
			<span className="flex min-w-0 flex-1 flex-col gap-2">
				<span className="tr-title-compact text-text-default">{t("mcp.githubRecipe.title")}</span>
				<span className="text-text-muted tr-text-metadata">
					<T
						i18nKey="mcp.githubRecipe.description"
						components={[<code key="command" className="tr-code-text" />]}
					/>
				</span>
			</span>
			<Button
				variant="outline"
				size="m"
				data-testid="mcp-github-recipe-use"
				disabled={disabled || added}
				onClick={onUse}
			>
				{added ? t("mcp.presets.added") : t("mcp.githubRecipe.use")}
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
			modifiesData?: MessageKey;
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
	onEnableInProject: (name: string) => Promise<void>;
}) {
	const t = useT();
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

	const issues = validateMcpDraft(t, draft, scope, existing);
	const warnings = [
		...mcpDraftWarnings(t, draft),
		...[mcpNameWarning(t, draft.name.trim(), scope, existing)].filter(
			(warning): warning is string => !!warning,
		),
	];
	const parsed = json.trim() ? parseMcpServersJson(t, json) : null;
	const parsedServers = parsed?.ok ? parsed.servers : [];
	const importable = parsedServers.filter(
		(server) =>
			importIssues(
				t,
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
		const results = await addMcpServersWithProjectOptIn(
			servers,
			targetScope,
			onAdd,
			optInPerProject ? onEnableInProject : undefined,
		);
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
					<DialogTitle>{reviewing ? t("mcp.review.title") : t("mcp.addDialog.title")}</DialogTitle>
					<DialogDescription>
						{reviewing ? t("mcp.addDialog.reviewDescription") : t("mcp.hostNotice")}
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					{step.kind === "review" ? (
						<McpRunReview
							reviews={step.reviews}
							modifiesData={step.modifiesData ? t(step.modifiesData) : undefined}
						/>
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
										{ id: "form", label: t("mcp.addDialog.tierForm") },
										{ id: "json", label: t("mcp.addDialog.tierJson") },
									]}
									onChange={setTier}
								/>
								<Segments
									testId="mcp-add-scope"
									value={scope}
									options={[
										{ id: "user", label: t("mcp.addDialog.scopeUser") },
										{
											id: "project",
											label: t("mcp.addDialog.scopeProject"),
											disabled: !projectScopeAvailable,
										},
									]}
									onChange={setSelectedScope}
								/>
							</div>
							{!projectScopeAvailable ? (
								<p className="text-text-muted tr-text-metadata">{t("mcp.addDialog.untrusted")}</p>
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
								{t("common.back")}
							</Button>
							<Button
								data-testid="mcp-add-confirm"
								disabled={saving}
								onClick={() => void save(step.servers, step.scope, step.from, step.optInPerProject)}
							>
								{step.servers.length > 1
									? t("mcp.addDialog.addServers")
									: t("mcp.addDialog.addServer")}
							</Button>
						</>
					) : (
						<>
							<Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
								{t("common.cancel")}
							</Button>
							{tier === "form" ? (
								<Button data-testid="mcp-add-submit" disabled={saving} onClick={submitForm}>
									{t("mcp.addDialog.addServer")}
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
										? t("mcp.addDialog.addSome", {
												count: importable.length,
												total: parsedServers.length,
											})
										: importable.length > 1
											? t("mcp.addDialog.addCount", { count: importable.length })
											: t("mcp.addDialog.addServer")}
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
	t: Translator,
	text: string,
	written: McpServerEntryInput,
): { entry: McpServerEntryInput | null; errors: string[] } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		return {
			entry: null,
			errors: [
				t("mcp.entries.invalidJson", {
					error: error instanceof Error ? error.message : String(error),
				}),
			],
		};
	}
	const errors = mcpEntryErrors(t, parsed);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return { entry: null, errors };
	}
	const edited = mcpEditedEntry(t, parsed as McpServerEntryInput, written);
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
	const t = useT();
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
	const { entry, errors } = editErrors(t, text, target.entry);
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
					<DialogTitle>
						{review ? t("mcp.review.title") : t("mcp.editDialog.title", { name })}
					</DialogTitle>
					<DialogDescription>{t("mcp.editDialog.description")}</DialogDescription>
				</DialogHeader>
				<DialogBody>
					{review ? (
						<McpRunReview reviews={review.reviews} />
					) : (
						<div className="flex flex-col gap-8">
							{shown.includes(MCP_HIDDEN_VALUE) ? (
								<p data-testid="mcp-edit-hidden" className="text-text-muted tr-text-metadata">
									<T
										i18nKey="mcp.editDialog.hiddenHint"
										values={{ hidden: MCP_HIDDEN_VALUE, reference: NAME_REFERENCE }}
										components={[
											<code key="hidden" className="tr-code-text" />,
											<code key="reference" className="tr-code-text" />,
											<code key="command" className="tr-code-text" />,
										]}
									/>
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
								{t("common.back")}
							</Button>
							<Button
								data-testid="mcp-edit-confirm"
								disabled={saving}
								onClick={() => void commit(review.entry)}
							>
								{t("common.save")}
							</Button>
						</>
					) : (
						<>
							<Button variant="outline" disabled={saving} onClick={onClose}>
								{t("common.cancel")}
							</Button>
							<Button
								data-testid="mcp-edit-save"
								disabled={saving || !entry || errors.length > 0}
								onClick={submit}
							>
								{t("common.save")}
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
	const t = useT();
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
					<DialogTitle>{t("mcp.approveDialog.title", { name: summary.name })}</DialogTitle>
					<DialogDescription>
						{summary.approval?.state === "changed"
							? t("mcp.approveDialog.changedDescription")
							: t("mcp.approveDialog.description")}
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
									{t("mcp.approveDialog.replacesGlobal", { name: summary.name })}
								</p>
							) : null}
							{facts.overrides.length > 0 ? (
								<FactRow label={t("mcp.approveDialog.overrides")}>
									<CodeBlock>{facts.overrides.join("\n")}</CodeBlock>
								</FactRow>
							) : null}
							{facts.defines === "command" ? (
								<FactRow label={runLabel(t, "command")}>
									<CodeBlock testId="mcp-approve-run">{summary.endpoint}</CodeBlock>
								</FactRow>
							) : null}
							{facts.runs.map((run) => (
								<FactRow key={`${run.label}:${run.text}`} label={runLabel(t, run.label)}>
									<CodeBlock testId="mcp-approve-run">{run.text}</CodeBlock>
								</FactRow>
							))}
							{facts.defines === "url" ? (
								<FactRow label={t("mcp.approveDialog.connectsTo")}>
									<CodeBlock>{summary.endpoint}</CodeBlock>
								</FactRow>
							) : null}
							{facts.cwd ? (
								<FactRow label={t("mcp.approveDialog.cwd")}>
									<CodeBlock>{facts.cwd}</CodeBlock>
								</FactRow>
							) : null}
							{facts.env.length > 0 ? (
								<FactRow label={t("mcp.approveDialog.env")}>
									<CodeBlock testId="mcp-approve-env">
										{facts.env.map((fact) => `${fact.name}=${fact.value}`).join("\n")}
									</CodeBlock>
								</FactRow>
							) : null}
							{facts.headers.length > 0 ? (
								<FactRow label={t("mcp.approveDialog.headers")}>
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
						{t("common.cancel")}
					</Button>
					<Button
						data-testid="mcp-approve-confirm"
						disabled={saving || !facts || !summary.approval}
						onClick={() => void approve()}
					>
						{t("mcp.approveDialog.approve")}
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
	const t = useT();
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
						<FactRow label={t("mcp.details.status")}>
							{view.label}
							{view.reason ? ` — ${view.reason}` : ""}
						</FactRow>
						<FactRow
							label={summary.transport === "http" ? t("mcp.details.url") : t("mcp.details.command")}
						>
							<CodeBlock testId="mcp-details-endpoint">{summary.endpoint}</CodeBlock>
						</FactRow>
						<FactRow label={t("mcp.details.source")}>
							<CodeBlock>{summary.source}</CodeBlock>
						</FactRow>
						<FactRow label={t("mcp.details.scope")}>
							{summary.replacesGlobal
								? t("mcp.details.scopeReplacing", { scope: t(SCOPE_LABEL[summary.scope]) })
								: t(SCOPE_LABEL[summary.scope])}
						</FactRow>
						<FactRow label={t("mcp.details.effectiveExposure")}>
							<span data-testid="mcp-details-exposure">
								{mcpExposureLabel(t, summary.effectiveExposure)}
							</span>
						</FactRow>
						{summary.exposure !== summary.effectiveExposure ? (
							<FactRow label={t("mcp.details.configuredExposure")}>
								{mcpConfiguredExposureText(t, summary)}
							</FactRow>
						) : null}
						{summary.projectOverride ? (
							<FactRow label={t("mcp.details.projectSetting")}>
								{[
									summary.projectOverride.enabled === undefined
										? null
										: summary.projectOverride.enabled
											? t("mcp.details.enabled")
											: t("mcp.details.disabled"),
									summary.projectOverride.exposure ?? null,
								]
									.filter(Boolean)
									.join(", ")}
							</FactRow>
						) : null}
						{row.sessions.total > 0 ? (
							<FactRow label={t("mcp.details.liveChats")}>
								{t("mcp.details.liveChatsValue", {
									total: row.sessions.total,
									connected: row.sessions.connected,
								})}
							</FactRow>
						) : null}
						{summary.configError ? (
							<FactRow label={t("mcp.details.configError")}>
								<CodeBlock>{summary.configError}</CodeBlock>
							</FactRow>
						) : null}
						{row.detail && row.detail !== summary.configError ? (
							<FactRow label={t("mcp.lastReport")}>
								<CodeBlock testId="mcp-details-detail">{row.detail}</CodeBlock>
							</FactRow>
						) : null}
					</dl>
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						{t("common.close")}
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
	const t = useT();
	const { name } = row.summary;
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				data-testid="mcp-log-dialog"
				className="flex max-h-[85vh] max-w-[40rem] flex-col"
			>
				<DialogHeader>
					<DialogTitle>{t("mcp.log.title", { name })}</DialogTitle>
					<DialogDescription>{t("mcp.log.description")}</DialogDescription>
				</DialogHeader>
				<DialogBody>
					<dl className="flex flex-col gap-12">
						{row.detail ? (
							<FactRow label={t("mcp.lastReport")}>
								<CodeBlock testId="mcp-log-report">{row.detail}</CodeBlock>
							</FactRow>
						) : null}
						<FactRow label={t("mcp.log.messages")}>
							{read.state === "reading" ? (
								<span className="text-text-muted tr-text-metadata">{t("mcp.log.reading")}</span>
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
											{t("mcp.log.empty", { name })}
										</span>
									)}
								</span>
							)}
						</FactRow>
					</dl>
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						{t("common.close")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
