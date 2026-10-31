import { RiInformationLine } from "@remixicon/react";
import {
	type PiPackageScope,
	type PiPackageSummary,
	type PiPackagesCatalog,
	parsePiPackageInput,
	type WsErrorCode,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { type Translator, useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { cn } from "@thinkrail/ui/utils";
import { Fragment, useId, useState } from "react";
import { errorText, RequestTimeoutError, wsErrorCode } from "@/transport";
import { CHIP_CLASS, GalleryLink, packageChips } from "./PiPackagesSettings";
import { SegmentedControl } from "./SegmentedControl";
import { SettingsNotice } from "./SettingsNotice";

const INPUT_CLASS =
	"w-full min-w-0 rounded-sm border border-control-border-default bg-control-bg px-8 py-4 tr-code-text text-text-default outline-none placeholder:text-text-muted focus-visible:border-control-border-active disabled:border-control-disabled-border disabled:bg-control-disabled-bg disabled:text-control-disabled-text";

/** A light reading of the source for the echo line only; the host is the validator. */
export function describeSource(t: Translator, raw: string): string | null {
	const { source } = parsePiPackageInput(raw);
	if (!source) return null;
	if (source.startsWith("npm:")) {
		const spec = source.slice(4).trim();
		const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/);
		const name = match?.[1] ?? spec;
		const version = match?.[2];
		return version && /^\d+\.\d+\.\d+/.test(version)
			? t("settings.packages.installDialog.parsed.npmPinned", { name, version })
			: t("settings.packages.installDialog.parsed.npm", { name });
	}
	if (/^(git:|github:|https?:|ssh:|git@)/.test(source)) {
		return t("settings.packages.installDialog.parsed.git", {
			repo: source.replace(/^git:/, "").replace(/\.git$/, ""),
		});
	}
	return t("settings.packages.installDialog.parsed.local", { path: source });
}

export function sourceDisplayName(raw: string): string {
	const { source } = parsePiPackageInput(raw);
	if (source.startsWith("npm:")) {
		const spec = source.slice(4).trim();
		return spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/)?.[1] ?? spec;
	}
	const noRef = source
		.replace(/^git:/, "")
		.replace(/\.git$/, "")
		.replace(/[#@][^/]*$/, "");
	const last = noRef.split("/").filter(Boolean).at(-1);
	return last ?? source;
}

export type InstallStep =
	| { kind: "form" }
	| { kind: "installing"; name: string }
	| { kind: "installed"; summary: PiPackageSummary }
	| { kind: "failed"; name: string; message: string; outcome: InstallFailureOutcome };

/** What the failure says about the settings: nothing changed, or the install may have landed anyway. */
export type InstallFailureOutcome = "nothingAdded" | "unknown" | "timedOut";

const NOTHING_ADDED_CODES: ReadonlySet<WsErrorCode> = new Set<WsErrorCode>([
	"PACKAGE_SOURCE_INVALID",
	"PACKAGE_OFFLINE",
	"PACKAGE_UNTRUSTED",
	"PACKAGE_INSTALL_FAILED",
	"PACKAGE_SETTINGS_WRITE_FAILED",
]);

export function installFailureOutcome(error: unknown): InstallFailureOutcome {
	if (error instanceof RequestTimeoutError) return "timedOut";
	const code = wsErrorCode(error);
	return code !== undefined && NOTHING_ADDED_CODES.has(code) ? "nothingAdded" : "unknown";
}

/** Title and description of each step, rendered by the dialog chrome (Radix needs them inside the Dialog). */
export function installStepHeader(
	t: Translator,
	step: InstallStep,
): { title: string; description?: string } {
	switch (step.kind) {
		case "form":
			return {
				title: t("settings.packages.installDialog.title"),
				description: t("settings.packages.installDialog.description"),
			};
		case "installing":
			return {
				title: t("settings.packages.installDialog.installingTitle", { name: step.name }),
				description: t("settings.packages.installDialog.installingDescription"),
			};
		case "installed":
			return {
				title: step.summary.version
					? `${t("settings.packages.installDialog.installedTitle", { name: step.summary.name })} · ${step.summary.version}`
					: t("settings.packages.installDialog.installedTitle", { name: step.summary.name }),
				...(step.summary.description ? { description: step.summary.description } : {}),
			};
		case "failed":
			return { title: t("settings.packages.installDialog.failedTitle", { name: step.name }) };
	}
}

export interface InstallPackageBodyProps {
	step: InstallStep;
	source: string;
	scope: PiPackageScope;
	catalog: PiPackagesCatalog | null;
	workspaceId: string | null;
	onSourceChange: (source: string) => void;
	onScopeChange: (scope: PiPackageScope) => void;
	onSubmit: () => void;
	onCancel: () => void;
	onBack: () => void;
	onDone: () => void;
}

/** The dialog's content, props-driven so each step renders without a portal. */
const SOURCE_EXAMPLES: readonly { key: MessageKey; example: string }[] = [
	{ key: "settings.packages.installDialog.sourceHelp.link", example: "https://pi.dev/packages/…" },
	{ key: "settings.packages.installDialog.sourceHelp.command", example: "pi install npm:…" },
	{ key: "settings.packages.installDialog.sourceHelp.npm", example: "@scope/name[@version]" },
	{
		key: "settings.packages.installDialog.sourceHelp.git",
		example: "https://github.com/owner/repo",
	},
	{ key: "settings.packages.installDialog.sourceHelp.local", example: "./tools or /abs/path" },
];

function SourceHelp() {
	const t = useT();
	return (
		<div data-testid="install-package-source-help-content" className="flex flex-col gap-6 py-2">
			<span className="text-text-default">
				{t("settings.packages.installDialog.sourceHelp.title")}
			</span>
			<div className="grid grid-cols-[auto_1fr] items-baseline gap-x-12 gap-y-4 text-text-muted">
				{SOURCE_EXAMPLES.map(({ key, example }) => (
					<Fragment key={key}>
						<span className="whitespace-nowrap">{t(key)}</span>
						<code className="tr-code-text-small whitespace-nowrap text-text-default">
							{example}
						</code>
					</Fragment>
				))}
			</div>
		</div>
	);
}

export function InstallPackageBody({
	step,
	source,
	scope,
	catalog,
	workspaceId,
	onSourceChange,
	onScopeChange,
	onSubmit,
	onCancel,
	onBack,
	onDone,
}: InstallPackageBodyProps) {
	const t = useT();
	const sourceInputId = useId();
	const projectAvailable = workspaceId !== null && catalog?.projectTrusted === true;
	const effectiveScope: PiPackageScope = projectAvailable ? scope : "user";
	const trimmed = parsePiPackageInput(source).source;
	const name = sourceDisplayName(trimmed);
	const echo = describeSource(t, source);
	const scopeHintPath =
		effectiveScope === "project"
			? (catalog?.projectSettingsPath ?? "")
			: (catalog?.settingsPath ?? "");
	return (
		<div data-testid="install-package-body" data-step={step.kind} className="flex flex-col gap-16">
			{step.kind === "form" ? (
				<>
					<div className="flex flex-col gap-12">
						<div className="flex flex-col gap-4">
							<span className="flex items-center gap-4">
								<label htmlFor={sourceInputId} className="tr-text-ui text-text-default">
									{t("settings.packages.installDialog.sourceLabel")}
								</label>
								<IconButton
									variant="ghost"
									size="s"
									icon={RiInformationLine}
									label={t("settings.packages.installDialog.sourceHelpLabel")}
									data-testid="install-package-source-help"
									tooltip={<SourceHelp />}
									tooltipSide="right"
									tooltipAlign="start"
								/>
							</span>
							<input
								id={sourceInputId}
								data-testid="install-package-source"
								className={INPUT_CLASS}
								value={source}
								placeholder={t("settings.packages.installDialog.sourcePlaceholder")}
								spellCheck={false}
								autoComplete="off"
								onChange={(event) => onSourceChange(event.currentTarget.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter" && trimmed) onSubmit();
								}}
							/>
							{echo ? (
								<span
									data-testid="install-package-echo"
									className="tr-text-metadata text-text-default"
								>
									{echo}
								</span>
							) : null}
						</div>
						<GalleryLink />
						<div className="flex flex-col gap-4">
							<span className="tr-text-ui text-text-default">
								{t("settings.packages.installDialog.scopeLabel")}
							</span>
							<SegmentedControl<PiPackageScope>
								name="install-package-scope"
								label={t("settings.packages.installDialog.scopeLabel")}
								testId="install-package-scope"
								value={effectiveScope}
								onSelect={onScopeChange}
								options={[
									{
										id: "user",
										label: t("settings.packages.installDialog.scope.user"),
										testId: "install-package-scope-user",
									},
									{
										id: "project",
										label: t("settings.packages.installDialog.scope.project"),
										testId: "install-package-scope-project",
										disabled: !projectAvailable,
									},
								]}
							/>
							<span className="tr-text-metadata text-text-muted">
								{!projectAvailable && workspaceId === null
									? t("settings.packages.installDialog.scopeNeedsWorkspace")
									: !projectAvailable
										? t("settings.packages.installDialog.scopeNeedsTrust")
										: effectiveScope === "project"
											? t("settings.packages.installDialog.scopeHintProject", {
													path: scopeHintPath,
												})
											: t("settings.packages.installDialog.scopeHintUser", {
													path: scopeHintPath,
												})}
							</span>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={onCancel}>
							{t("common.cancel")}
						</Button>
						<Button data-testid="install-package-submit" disabled={!trimmed} onClick={onSubmit}>
							{t("settings.packages.installDialog.submit", { name: name || "…" })}
						</Button>
					</DialogFooter>
				</>
			) : null}
			{step.kind === "installing" ? (
				<div
					data-testid="install-package-progress"
					role="progressbar"
					aria-label={t("settings.packages.installDialog.installingTitle", { name: step.name })}
					className="h-4 w-full overflow-hidden rounded-full bg-control-bg-selected"
				>
					<div className="h-full w-2/5 rounded-full bg-primary motion-safe:animate-working" />
				</div>
			) : null}
			{step.kind === "installed" ? (
				<>
					<div className="flex flex-col gap-12">
						<span className="flex flex-wrap gap-4" data-testid="install-package-chips">
							{[
								...packageChips(step.summary.resources),
								...step.summary.resources
									.filter((r) => r.type === "skills")
									.map((r) => t("settings.packages.skillChip", { name: r.displayName })),
								...step.summary.resources
									.filter((r) => r.type === "prompts")
									.map((r) => `/${r.displayName.replace(/\.md$/, "")}`),
							].map((chip) => (
								<code key={chip} className={cn("tr-code-text-small", CHIP_CLASS)}>
									{chip}
								</code>
							))}
						</span>
						<span
							className="tr-text-metadata text-text-muted"
							data-testid="install-package-applies"
						>
							{t(
								step.summary.scope === "project"
									? "settings.packages.installDialog.installedOnProject"
									: "settings.packages.installDialog.installedOnUser",
							)}
						</span>
					</div>
					<DialogFooter>
						<Button data-testid="install-package-done" onClick={onDone}>
							{t("common.done")}
						</Button>
					</DialogFooter>
				</>
			) : null}
			{step.kind === "failed" ? (
				<>
					<div className="flex flex-col gap-8">
						<SettingsNotice variant="error" testId="install-package-error">
							<span className="break-words">{step.message}</span>
						</SettingsNotice>
						{step.outcome === "timedOut" ? null : (
							<span className="tr-text-metadata text-text-muted">
								{step.outcome === "nothingAdded"
									? t("settings.packages.installDialog.failedNothingAdded")
									: t("settings.packages.installDialog.failedCheckList")}
							</span>
						)}
					</div>
					<DialogFooter>
						<Button variant="outline" data-testid="install-package-back" onClick={onBack}>
							{t("common.back")}
						</Button>
						<Button data-testid="install-package-retry" onClick={onSubmit}>
							{t("common.retry")}
						</Button>
					</DialogFooter>
				</>
			) : null}
		</div>
	);
}

export interface InstallPackageDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	catalog: PiPackagesCatalog | null;
	/** `null` when no workspace is active: the repository scope is then unavailable. */
	workspaceId: string | null;
	install: (request: { source: string; scope: PiPackageScope }) => Promise<PiPackageSummary>;
}

export function InstallPackageDialog({
	open,
	onOpenChange,
	catalog,
	workspaceId,
	install,
}: InstallPackageDialogProps) {
	const t = useT();
	const [source, setSource] = useState("");
	const [scope, setScope] = useState<PiPackageScope>("user");
	const [step, setStep] = useState<InstallStep>({ kind: "form" });

	const projectAvailable = workspaceId !== null && catalog?.projectTrusted === true;
	const effectiveScope: PiPackageScope = projectAvailable ? scope : "user";
	const trimmed = parsePiPackageInput(source).source;
	const name = sourceDisplayName(trimmed);
	const header = installStepHeader(t, step);

	const close = (next: boolean) => {
		if (step.kind === "installing") return;
		onOpenChange(next);
		if (!next) {
			setStep({ kind: "form" });
			setSource("");
		}
	};

	const submit = async () => {
		if (!trimmed) return;
		setStep({ kind: "installing", name });
		try {
			const summary = await install({ source: source.trim(), scope: effectiveScope });
			setStep({ kind: "installed", summary });
		} catch (error) {
			const outcome = installFailureOutcome(error);
			const message =
				outcome === "timedOut"
					? t("settings.packages.installDialog.timedOut")
					: errorText(error, t("settings.packages.actionFailed"));
			setStep({ kind: "failed", name, message, outcome });
		}
	};

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent data-testid="install-package-dialog" className="max-w-[30rem]">
				<DialogHeader>
					<DialogTitle>{header.title}</DialogTitle>
					{header.description ? <DialogDescription>{header.description}</DialogDescription> : null}
				</DialogHeader>
				<InstallPackageBody
					step={step}
					source={source}
					scope={scope}
					catalog={catalog}
					workspaceId={workspaceId}
					onSourceChange={(next) => {
						setSource(next);
						if (parsePiPackageInput(next).local) setScope("project");
					}}
					onScopeChange={setScope}
					onSubmit={() => void submit()}
					onCancel={() => close(false)}
					onBack={() => setStep({ kind: "form" })}
					onDone={() => close(false)}
				/>
			</DialogContent>
		</Dialog>
	);
}
