import {
	RiSubtractLine as Minus,
	RiAddLine as Plus,
	RiArrowGoBackLine as Reset,
} from "@remixicon/react";
import {
	type AppConfigUpdate,
	CODE_FONT_SIZE,
	FONT_ROLES,
	FONT_WEIGHT_OFFSET,
	type FontChoice,
	type FontFamilyRef,
	type FontRole,
	isCodeFontSize,
} from "@thinkrail/contracts";
import { T, useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import {
	bundledFaces,
	fontFacesRevision,
	previewFontWeightOffset,
	probeFont,
	sharesHostFonts,
	subscribeFontFaces,
	textWeightRange,
	type WeightResponse,
	weightResponse,
} from "@/fonts";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { FallbackChips, FontPicker } from "./FontPicker";
import {
	customFontFiles,
	displayFamily,
	fallbackFontOptions,
	fontOptions,
	type InstalledFonts,
	mainFontOptions,
	refFamilyName,
} from "./fontCatalog";
import { SettingsDisclosure } from "./SettingsDisclosure";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsNotice } from "./SettingsNotice";
import { SettingsRow } from "./SettingsRow";
import { SettingsSwitch } from "./SettingsSwitch";

const SLIDER =
	"absolute inset-0 h-24 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-none [&::-moz-range-thumb]:size-16 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-border-default [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:shadow-sm [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:size-16 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-border-default [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm focus-visible:[&::-moz-range-thumb]:ring-2 focus-visible:[&::-moz-range-thumb]:ring-primary focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-primary";

const WEIGHT_STEPS = Array.from(
	{ length: (FONT_WEIGHT_OFFSET.max - FONT_WEIGHT_OFFSET.min) / FONT_WEIGHT_OFFSET.step },
	(_, index) => FONT_WEIGHT_OFFSET.min + index * FONT_WEIGHT_OFFSET.step,
);

const CODE_BLOCK_SAMPLE =
	"const stack = fonts.code ?? defaults.code;\nif (size !== 13 && stack.length >= 1) apply(stack); // => -> <=";
const EDITOR_SAMPLE = [
	"export function apply(fonts: FontSettings) {",
	"  const code = fonts.code ?? DEFAULT_CODE;",
	'  return code.length >= 1 && code[0] !== "" ? code : null;',
	"}",
];
const TERMINAL_SAMPLE = ["~/thinkrail main ❯ bun run test", " ✓ 128 passed (1.42 s)"];

function saveFonts(config: AppConfigUpdate, failure: string): Promise<boolean> {
	return getTransport()
		.request("settings.update", { config })
		.then(
			() => true,
			(error: unknown) => {
				toast.error(errorText(error), failure);
				return false;
			},
		);
}

function WithReset({
	dirty,
	label,
	onReset,
	children,
}: {
	dirty: boolean;
	label: string;
	onReset: () => void;
	children: ReactNode;
}) {
	return (
		<div className="flex items-center gap-4">
			{children}
			{dirty ? (
				<IconButton icon={Reset} label={label} size="m" variant="ghost" onClick={onReset} />
			) : (
				<span className="size-24 shrink-0" />
			)}
		</div>
	);
}

function Subheading({ title, description }: { title: string; description: string }) {
	return (
		<div className="flex min-w-0 flex-col gap-2 border-border-muted border-b pt-16 pb-8">
			<span className="tr-text-ui text-text-default">{title}</span>
			<span className="break-words text-text-muted tr-text-metadata">{description}</span>
		</div>
	);
}

export function FontPreview({ codeFontSize }: { codeFontSize: number }) {
	const t = useT();
	return (
		<div
			data-testid="font-preview"
			className="flex flex-col gap-12 rounded-md border border-border-default bg-container-content-bg p-12"
		>
			<div className="flex items-center justify-between gap-8">
				<span className="tr-title-compact text-text-default">
					{t("settings.appearance.fonts.preview.title")}
				</span>
				<span className="text-text-muted tr-text-metadata">
					{t("settings.appearance.fonts.preview.meta")}
				</span>
			</div>
			<div className="tr-prose-chat [&_p]:my-0">
				<p>
					<T
						i18nKey="settings.appearance.fonts.preview.message"
						components={[<strong key="files" />, <code key="command" className="tr-code-text" />]}
					/>
				</p>
				<pre className="tr-code-block mt-8 overflow-x-auto rounded-sm bg-container-elevated-bg p-8 text-text-default">
					<code className="tr-code-block">{CODE_BLOCK_SAMPLE}</code>
				</pre>
			</div>
			<div className="flex gap-8">
				<Button variant="soft-primary" size="m">
					{t("settings.appearance.fonts.preview.openPr")}
				</Button>
				<Button variant="outline" size="m">
					{t("settings.appearance.fonts.preview.review")}
				</Button>
			</div>
			<div className="grid gap-8 md:grid-cols-2">
				<div className="flex min-w-0 flex-col gap-4">
					<span className="text-text-subtle tr-text-eyebrow">
						{t("settings.appearance.fonts.preview.editor", {
							size: codeFontSize - CODE_FONT_SIZE.editorDelta,
						})}
					</span>
					<pre className="tr-code-editor m-0 overflow-x-auto rounded-sm border border-border-muted p-8 text-text-default">
						{EDITOR_SAMPLE.map((line, index) => (
							<span key={line} className="block whitespace-pre">
								<span className="text-text-subtle">{`${index + 1}  `}</span>
								{line}
							</span>
						))}
					</pre>
				</div>
				<div className="flex min-w-0 flex-col gap-4">
					<span className="text-text-subtle tr-text-eyebrow">
						{t("settings.appearance.fonts.preview.terminal", { size: codeFontSize })}
					</span>
					<pre className="tr-code-block m-0 overflow-x-auto rounded-sm bg-container-terminal-bg p-8 text-text-default">
						{TERMINAL_SAMPLE.join("\n")}
					</pre>
				</div>
			</div>
		</div>
	);
}

function useWeightResponses(families: readonly string[], facesRevision: number) {
	const key = [facesRevision, ...new Set(families)].join("\n");
	const [responses, setResponses] = useState<Readonly<Record<string, WeightResponse>>>({});
	useEffect(() => {
		const [, ...names] = key.split("\n");
		if (names.length === 0) return;
		let cancelled = false;
		const weights = textWeightRange();
		void Promise.all(
			names.map((family) =>
				weightResponse(family, weights).then((response) => [family, response] as const),
			),
		).then((results) => {
			if (!cancelled) setResponses(Object.fromEntries(results));
		});
		return () => {
			cancelled = true;
		};
	}, [key]);
	return responses;
}

function WeightRow({
	value,
	onCommit,
	hints,
}: {
	value: number;
	onCommit: (next: number) => Promise<boolean>;
	hints: ReactNode;
}) {
	const t = useT();
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	const commit = (next: number) => {
		if (next === value) return;
		void onCommit(next).then((saved) => {
			if (saved) return;
			previewFontWeightOffset(null);
			setDraft(value);
		});
	};
	const low = Math.min(0, draft);
	const high = Math.max(0, draft);
	const shown = draft === 0 ? t("common.default") : draft > 0 ? `+${draft}` : `−${-draft}`;
	return (
		<div
			data-testid="font-weight"
			className="flex flex-col gap-8 border-border-muted border-b py-12"
		>
			<div className="flex items-start justify-between gap-12">
				<div className="flex min-w-0 flex-1 flex-col gap-2">
					<span className="tr-text-ui text-text-default">
						{t("settings.appearance.fonts.weight")}
					</span>
					<span className="text-text-muted tr-text-metadata">
						{t("settings.appearance.fonts.weightDescription")}
					</span>
				</div>
				<WithReset
					dirty={value !== FONT_WEIGHT_OFFSET.default}
					label={t("settings.appearance.fonts.reset")}
					onReset={() => {
						setDraft(FONT_WEIGHT_OFFSET.default);
						previewFontWeightOffset(FONT_WEIGHT_OFFSET.default);
						commit(FONT_WEIGHT_OFFSET.default);
					}}
				>
					<span data-testid="font-weight-value" className="tr-text-ui text-text-default">
						{shown}
					</span>
				</WithReset>
			</div>
			<div className="relative h-24">
				<div className="absolute inset-x-0 top-1/2 flex h-4 -translate-y-1/2 overflow-hidden rounded-full bg-control-bg">
					{WEIGHT_STEPS.map((start) => (
						<span
							key={start}
							className={cn(
								"h-full flex-1",
								start >= low && start < high ? "bg-primary" : "bg-control-bg",
								start === FONT_WEIGHT_OFFSET.default && "border-text-subtle border-l-2",
							)}
						/>
					))}
				</div>
				<input
					type="range"
					data-testid="font-weight-input"
					aria-label={t("settings.appearance.fonts.weight")}
					aria-valuetext={shown}
					min={FONT_WEIGHT_OFFSET.min}
					max={FONT_WEIGHT_OFFSET.max}
					step={FONT_WEIGHT_OFFSET.step}
					value={draft}
					onChange={(event) => {
						const next = Number(event.currentTarget.value);
						setDraft(next);
						previewFontWeightOffset(next);
					}}
					onPointerUp={() => commit(draft)}
					onKeyUp={() => commit(draft)}
					onBlur={() => commit(draft)}
					className={SLIDER}
				/>
			</div>
			<div className="flex items-center justify-between text-text-muted tr-text-metadata">
				<span>{t("settings.appearance.fonts.weightLighter")}</span>
				<span>{t("settings.appearance.fonts.weightHeavier")}</span>
			</div>
			{hints}
		</div>
	);
}

function CodeSizeRow({ value, onCommit }: { value: number; onCommit: (next: number) => void }) {
	const t = useT();
	const [draft, setDraft] = useState(String(value));
	useEffect(() => setDraft(String(value)), [value]);
	const parsed = Number(draft);
	const invalid = !isCodeFontSize(parsed);
	const current = invalid ? value : parsed;
	const commit = () => {
		if (!invalid && parsed !== value) onCommit(parsed);
	};
	const step = (next: number) => {
		setDraft(String(next));
		onCommit(next);
	};
	return (
		<SettingsRow
			label={t("settings.appearance.fonts.size")}
			testId="font-code-size"
			description={
				<>
					{t("settings.appearance.fonts.sizeDescription", { delta: CODE_FONT_SIZE.editorDelta })}
					{invalid ? (
						<span className="block text-feedback-error tr-text-metadata">
							{t("settings.appearance.fonts.sizeInvalid", {
								min: CODE_FONT_SIZE.min,
								max: CODE_FONT_SIZE.max,
							})}
						</span>
					) : null}
				</>
			}
			control={
				<WithReset
					dirty={value !== CODE_FONT_SIZE.default}
					label={t("settings.appearance.fonts.reset")}
					onReset={() => onCommit(CODE_FONT_SIZE.default)}
				>
					<div className="flex items-center gap-4">
						<IconButton
							icon={Minus}
							label={t("settings.appearance.fonts.smaller")}
							variant="outline"
							size="l"
							disabled={current <= CODE_FONT_SIZE.min}
							onClick={() => step(current - 1)}
						/>
						<input
							type="number"
							min={CODE_FONT_SIZE.min}
							max={CODE_FONT_SIZE.max}
							step={1}
							inputMode="numeric"
							value={draft}
							aria-label={t("settings.appearance.fonts.sizeInput")}
							aria-invalid={invalid}
							data-testid="font-code-size-input"
							data-settings-draft-input
							onChange={(event) => setDraft(event.currentTarget.value)}
							onBlur={commit}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									commit();
								} else if (event.key === "Escape") {
									setDraft(String(value));
								}
							}}
							className="h-32 w-64 rounded-sm border border-control-border-default bg-control-bg px-8 text-center tr-text-ui text-text-default outline-none focus:border-control-border-active focus-visible:ring-2 focus-visible:ring-primary aria-invalid:border-feedback-error"
						/>
						<IconButton
							icon={Plus}
							label={t("settings.appearance.fonts.larger")}
							variant="outline"
							size="l"
							disabled={current >= CODE_FONT_SIZE.max}
							onClick={() => step(current + 1)}
						/>
					</div>
				</WithReset>
			}
		/>
	);
}

export function FontsGroup() {
	const t = useT();
	const interfaceFont = useAppStore((state) => state.interfaceFont);
	const codeFont = useAppStore((state) => state.codeFont);
	const codeFontSize = useAppStore((state) => state.codeFontSize);
	const codeLigatures = useAppStore((state) => state.codeLigatures);
	const fontWeightOffset = useAppStore((state) => state.fontWeightOffset);
	const userFonts = useAppStore((state) => state.userFonts);
	const [installed, setInstalled] = useState<InstalledFonts>({ status: "idle" });
	const [pending, setPending] = useState<ReadonlySet<FontRole>>(new Set());
	const [advanced, setAdvanced] = useState(false);
	const failure = t("settings.appearance.fonts.changeFailed");
	const faces = bundledFaces();
	const shares = sharesHostFonts();
	const facesRevision = useSyncExternalStore(subscribeFontFaces, fontFacesRevision);
	const probe = (family: string) => probeFont(family, facesRevision);
	const options = fontOptions({ faces, userFonts, installed, probe });
	const customFamilies = new Set(customFontFiles(userFonts).map((file) => file.face.family));
	const choices: Record<FontRole, FontChoice> = { interface: interfaceFont, code: codeFont };

	const readInstalled = () => {
		setInstalled({ status: "loading" });
		getTransport()
			.request("fonts.installed", {})
			.then(
				(result) => setInstalled({ status: "ready", families: result.families }),
				() => setInstalled({ status: "failed" }),
			);
	};
	const saveChoice = (role: FontRole, next: FontChoice) => {
		setPending((current) => new Set(current).add(role));
		void saveFonts(
			role === "interface" ? { interfaceFont: next } : { codeFont: next },
			failure,
		).then(() =>
			setPending((current) => {
				const rest = new Set(current);
				rest.delete(role);
				return rest;
			}),
		);
	};
	const familyOf = (ref: FontFamilyRef) => refFamilyName(ref, "interface", faces);
	const namedFamily = (role: FontRole) => {
		const ref = choices[role].family;
		return ref !== null && "name" in ref ? ref.name : null;
	};
	const renderedNamed = FONT_ROLES.flatMap((role) => {
		const named = namedFamily(role);
		return named !== null && (customFamilies.has(named) || probe(named).renders) ? [named] : [];
	});
	const weightResponses = useWeightResponses(renderedNamed, facesRevision);
	const weightHints = [...new Set(renderedNamed)].flatMap((family) => {
		const response = weightResponses[family];
		if (response === undefined || response === "smooth") return [];
		return [
			<SettingsNotice key={family} variant="info" testId="font-weight-hint" className="mt-4">
				{response === "fixed"
					? t("settings.appearance.fonts.weightFixed", {
							family,
							interface: displayFamily(faces.interface),
							code: displayFamily(faces.code),
						})
					: t("settings.appearance.fonts.weightSteps", { family })}
			</SettingsNotice>,
		];
	});
	const picker = (role: FontRole) => ({
		role,
		installed,
		probe,
		sharesHostFonts: shares,
		disabled: pending.has(role),
		onOpen: readInstalled,
		onRetry: readInstalled,
		testId: `font-${role}`,
	});

	const fontRow = (role: FontRole) => {
		const choice = choices[role];
		const family = refFamilyName(choice.family, role, faces);
		const named = choice.family !== null && "name" in choice.family ? choice.family.name : null;
		const unavailable = named !== null && !customFamilies.has(named) && !probe(named).renders;
		return (
			<>
				<SettingsRow
					label={t("settings.appearance.fonts.font")}
					testId={`font-${role}-row`}
					control={
						<WithReset
							dirty={choice.family !== null}
							label={t("settings.appearance.fonts.reset")}
							onReset={() => saveChoice(role, { ...choice, family: null })}
						>
							<FontPicker
								{...picker(role)}
								label={
									role === "interface"
										? t("settings.appearance.fonts.interfaceFont")
										: t("settings.appearance.fonts.codeFont")
								}
								options={mainFontOptions(options, role, shares)}
								family={family}
								value={choice.family}
								unavailable={unavailable}
								onSelect={(ref) => saveChoice(role, { ...choice, family: ref })}
							/>
						</WithReset>
					}
				/>
				{unavailable ? (
					<div className="border-border-muted border-b py-12">
						<SettingsNotice variant="warning" testId={`font-${role}-unavailable`}>
							{t("settings.appearance.fonts.unavailable", {
								family: displayFamily(family),
								fallback: displayFamily(faces[role]),
							})}
						</SettingsNotice>
					</div>
				) : null}
			</>
		);
	};

	const fallbackRow = (role: FontRole) => {
		const choice = choices[role];
		return (
			<SettingsRow
				label={
					role === "interface"
						? t("settings.appearance.fonts.interfaceFallbacks")
						: t("settings.appearance.fonts.codeFallbacks")
				}
				description={
					role === "interface"
						? t("settings.appearance.fonts.interfaceFallbacksDescription")
						: t("settings.appearance.fonts.codeFallbacksDescription")
				}
				testId={`font-${role}-fallbacks-row`}
				control={
					<FallbackChips
						{...picker(role)}
						testId={`font-${role}-fallbacks`}
						options={fallbackFontOptions(options, [
							...(choice.family ? [choice.family] : [{ builtin: role }]),
							...choice.fallbacks,
						])}
						values={choice.fallbacks}
						familyOf={familyOf}
						onChange={(fallbacks) => saveChoice(role, { ...choice, fallbacks })}
					/>
				}
			/>
		);
	};

	return (
		<SettingsGroup
			title={t("settings.appearance.fonts.title")}
			description={t("settings.appearance.fonts.description")}
			testId="settings-fonts"
		>
			<div className="border-border-muted border-b pb-12">
				<FontPreview codeFontSize={codeFontSize} />
			</div>
			<Subheading
				title={t("settings.appearance.fonts.interface.title")}
				description={t("settings.appearance.fonts.interface.description")}
			/>
			{fontRow("interface")}
			<WeightRow
				value={fontWeightOffset}
				onCommit={(next) => saveFonts({ fontWeightOffset: next }, failure)}
				hints={weightHints}
			/>
			<Subheading
				title={t("settings.appearance.fonts.code.title")}
				description={t("settings.appearance.fonts.code.description")}
			/>
			{fontRow("code")}
			<CodeSizeRow
				value={codeFontSize}
				onCommit={(next) => void saveFonts({ codeFontSize: next }, failure)}
			/>
			<SettingsRow
				label={t("settings.appearance.fonts.ligatures")}
				description={t("settings.appearance.fonts.ligaturesDescription")}
				testId="font-ligatures-row"
				control={
					<WithReset
						dirty={codeLigatures}
						label={t("settings.appearance.fonts.reset")}
						onReset={() => void saveFonts({ codeLigatures: false }, failure)}
					>
						<SettingsSwitch
							checked={codeLigatures}
							label={t("settings.appearance.fonts.ligatures")}
							testId="font-ligatures"
							onChange={(next) => void saveFonts({ codeLigatures: next }, failure)}
						/>
					</WithReset>
				}
			/>
			<SettingsDisclosure
				label={t("settings.appearance.fonts.advanced")}
				summary={t("settings.appearance.fonts.advancedSummary")}
				expanded={advanced}
				testId="font-advanced-toggle"
				onToggle={() => setAdvanced((value) => !value)}
			>
				<div className="flex flex-col pb-12 [&>*:last-child]:border-b-0">
					{fallbackRow("interface")}
					{fallbackRow("code")}
				</div>
			</SettingsDisclosure>
		</SettingsGroup>
	);
}
