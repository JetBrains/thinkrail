import {
	RiSubtractLine as Minus,
	RiAddLine as Plus,
	RiArrowGoBackLine as Reset,
} from "@remixicon/react";
import {
	CODE_FONT_SIZE,
	FONT_ROLES,
	FONT_WEIGHT_OFFSET,
	type FontChoice,
	type FontRole,
	isCodeFontSize,
} from "@thinkrail/contracts";
import { T, useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
	bundledFaces,
	DEFAULT_FONT_PREFERENCE,
	fontFacesRevision,
	previewFontWeightOffset,
	probeFont,
	refFamily,
	roleFamily,
	sharesHostFonts,
	subscribeFontFaces,
	textWeightRange,
	type WeightResponse,
	weightResponse,
} from "@/fonts";
import { useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { FallbackChips, FontPicker } from "./FontPicker";
import {
	customFamilies,
	displayFamily,
	fallbackFontOptions,
	fontOptions,
	type InstalledFonts,
	mainFontOptions,
} from "./fontCatalog";
import { SettingsDisclosure } from "./SettingsDisclosure";
import { SettingsGroup, SettingsSubheading } from "./SettingsGroup";
import { SettingsNotice } from "./SettingsNotice";
import { SETTINGS_RANGE_INPUT, SettingsRangeTrack } from "./SettingsRange";
import { SETTINGS_ROWS_CONTAINER, SettingsRow } from "./SettingsRow";
import { SettingsSwitch } from "./SettingsSwitch";
import { saveSettings } from "./saveSettings";
import { SETTINGS_INPUT, useSettingsDraft } from "./settingsDraft";

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

function WithReset({
	dirty,
	label,
	disabled = false,
	onReset,
	children,
}: {
	dirty: boolean;
	label: string;
	disabled?: boolean;
	onReset: () => void;
	children: ReactNode;
}) {
	return (
		<div className="flex items-center gap-4">
			{children}
			{dirty ? (
				<IconButton
					icon={Reset}
					label={label}
					size="m"
					variant="ghost"
					disabled={disabled}
					onClick={onReset}
				/>
			) : (
				<span className="size-24 shrink-0" />
			)}
		</div>
	);
}

export function FontPreview({ codeFontSize }: { codeFontSize: number }) {
	const t = useT();
	return (
		<div
			inert
			data-testid="font-preview"
			className="flex flex-col gap-12 rounded-md border border-border-default bg-container-workspace-bg p-12"
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
	const { draft, setDraft, submit, commitDraft } = useSettingsDraft({
		saved: String(value),
		isValid: () => true,
		commit: (next) =>
			onCommit(Number(next)).then((stored) => {
				if (!stored) previewFontWeightOffset(null);
				return stored;
			}),
	});
	useEffect(() => () => previewFontWeightOffset(null), []);
	const offset = Number(draft);
	const low = Math.min(FONT_WEIGHT_OFFSET.default, offset);
	const high = Math.max(FONT_WEIGHT_OFFSET.default, offset);
	const shown = offset === 0 ? t("common.default") : offset > 0 ? `+${offset}` : `−${-offset}`;
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
					dirty={value !== DEFAULT_FONT_PREFERENCE.fontWeightOffset}
					label={t("settings.appearance.fonts.resetWeight")}
					onReset={() => {
						previewFontWeightOffset(DEFAULT_FONT_PREFERENCE.fontWeightOffset);
						submit(String(DEFAULT_FONT_PREFERENCE.fontWeightOffset));
					}}
				>
					<span data-testid="font-weight-value" className="tr-text-ui text-text-default">
						{shown}
					</span>
				</WithReset>
			</div>
			<SettingsRangeTrack
				steps={WEIGHT_STEPS}
				filled={(start) => start >= low && start < high}
				marker={FONT_WEIGHT_OFFSET.default}
			>
				<input
					type="range"
					data-testid="font-weight-input"
					aria-label={t("settings.appearance.fonts.weight")}
					aria-valuetext={shown}
					min={FONT_WEIGHT_OFFSET.min}
					max={FONT_WEIGHT_OFFSET.max}
					step={FONT_WEIGHT_OFFSET.step}
					value={offset}
					onChange={(event) => {
						const next = Number(event.currentTarget.value);
						setDraft(String(next));
						previewFontWeightOffset(next);
					}}
					onPointerUp={commitDraft}
					onKeyUp={commitDraft}
					onBlur={commitDraft}
					className={cn(SETTINGS_RANGE_INPUT, "cursor-pointer")}
				/>
			</SettingsRangeTrack>
			<div className="flex items-center justify-between text-text-muted tr-text-metadata">
				<span>{t("settings.appearance.fonts.weightLighter")}</span>
				<span>{t("settings.appearance.fonts.weightHeavier")}</span>
			</div>
			{hints}
		</div>
	);
}

function CodeSizeRow({
	value,
	onCommit,
}: {
	value: number;
	onCommit: (next: number) => Promise<boolean>;
}) {
	const t = useT();
	const { draft, invalid, submit, inputProps } = useSettingsDraft({
		saved: String(value),
		isValid: (next) => /^\d+$/.test(next) && isCodeFontSize(Number(next)),
		commit: (next) => onCommit(Number(next)),
	});
	const current = invalid ? value : Number(draft);
	const errorId = "font-code-size-error";
	return (
		<SettingsRow
			label={t("settings.appearance.fonts.size")}
			testId="font-code-size"
			description={
				<>
					{t("settings.appearance.fonts.sizeDescription", { delta: CODE_FONT_SIZE.editorDelta })}
					{invalid ? (
						<span id={errorId} className="block text-feedback-error tr-text-metadata">
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
					dirty={value !== DEFAULT_FONT_PREFERENCE.codeFontSize}
					label={t("settings.appearance.fonts.resetSize")}
					onReset={() => submit(String(DEFAULT_FONT_PREFERENCE.codeFontSize))}
				>
					<div className="flex items-center gap-4">
						<IconButton
							icon={Minus}
							label={t("settings.appearance.fonts.smaller")}
							variant="outline"
							size="l"
							disabled={current <= CODE_FONT_SIZE.min}
							onClick={() => submit(String(current - 1))}
						/>
						<input
							type="number"
							min={CODE_FONT_SIZE.min}
							max={CODE_FONT_SIZE.max}
							step={1}
							inputMode="numeric"
							{...inputProps}
							aria-label={t("settings.appearance.fonts.sizeInput")}
							aria-describedby={invalid ? errorId : undefined}
							data-testid="font-code-size-input"
							className={cn(SETTINGS_INPUT, "w-64 text-center")}
						/>
						<IconButton
							icon={Plus}
							label={t("settings.appearance.fonts.larger")}
							variant="outline"
							size="l"
							disabled={current >= CODE_FONT_SIZE.max}
							onClick={() => submit(String(current + 1))}
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
	const installedRequestRef = useRef(0);
	const [pending, setPending] = useState<ReadonlySet<FontRole>>(new Set());
	const [advanced, setAdvanced] = useState(false);
	const [faces] = useState(bundledFaces);
	const [shares] = useState(sharesHostFonts);
	const facesRevision = useSyncExternalStore(subscribeFontFaces, fontFacesRevision);
	const failure = t("settings.appearance.fonts.changeFailed");
	const probe = (family: string) => probeFont(family, facesRevision);
	const custom = customFamilies(userFonts);
	const options = fontOptions({ faces, custom, installed, probe });
	const choices: Record<FontRole, FontChoice> = { interface: interfaceFont, code: codeFont };
	const renders = (family: string) => custom.has(family) || probe(family).renders;
	const namedFamily = (role: FontRole) => {
		const ref = choices[role].family;
		return ref !== null && "name" in ref ? ref.name : null;
	};

	const readInstalled = () => {
		installedRequestRef.current += 1;
		const request = installedRequestRef.current;
		setInstalled((current) => (current.status === "ready" ? current : { status: "loading" }));
		getTransport()
			.request("fonts.installed", {})
			.then(
				(result) => {
					if (request === installedRequestRef.current) {
						setInstalled({ status: "ready", families: result.families });
					}
				},
				() => {
					if (request === installedRequestRef.current) {
						setInstalled((current) =>
							current.status === "ready" ? current : { status: "failed" },
						);
					}
				},
			);
	};
	const saveChoice = (role: FontRole, next: FontChoice) => {
		setPending((current) => new Set(current).add(role));
		void saveSettings(
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
	const renderedNamed = [
		...new Set(
			FONT_ROLES.flatMap((role) => {
				const named = namedFamily(role);
				return named !== null && renders(named) ? [named] : [];
			}),
		),
	];
	const weightResponses = useWeightResponses(renderedNamed, facesRevision);
	const weightHints = renderedNamed.flatMap((family) => {
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
		const family = roleFamily(choice.family, role, faces);
		const named = namedFamily(role);
		const unavailable = named !== null && !renders(named);
		const shown = displayFamily(family);
		return (
			<>
				<SettingsRow
					label={t("settings.appearance.fonts.font")}
					testId={`font-${role}-row`}
					control={
						<WithReset
							dirty={choice.family !== null}
							label={
								role === "interface"
									? t("settings.appearance.fonts.resetInterfaceFont")
									: t("settings.appearance.fonts.resetCodeFont")
							}
							disabled={pending.has(role)}
							onReset={() => saveChoice(role, { ...choice, family: null })}
						>
							<FontPicker
								{...picker(role)}
								label={
									role === "interface"
										? t("settings.appearance.fonts.interfaceFontValue", { family: shown })
										: t("settings.appearance.fonts.codeFontValue", { family: shown })
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
								family: shown,
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
						familyOf={(ref) => refFamily(ref, faces)}
						addLabel={
							role === "interface"
								? t("settings.appearance.fonts.addInterfaceFallback")
								: t("settings.appearance.fonts.addCodeFallback")
						}
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
			<SettingsSubheading
				title={t("settings.appearance.fonts.interface.title")}
				description={t("settings.appearance.fonts.interface.description")}
			/>
			{fontRow("interface")}
			<WeightRow
				value={fontWeightOffset}
				onCommit={(next) => saveSettings({ fontWeightOffset: next }, failure)}
				hints={weightHints}
			/>
			<SettingsSubheading
				title={t("settings.appearance.fonts.code.title")}
				description={t("settings.appearance.fonts.code.description")}
			/>
			{fontRow("code")}
			<CodeSizeRow
				value={codeFontSize}
				onCommit={(next) => saveSettings({ codeFontSize: next }, failure)}
			/>
			<SettingsRow
				label={t("settings.appearance.fonts.ligatures")}
				description={t("settings.appearance.fonts.ligaturesDescription")}
				testId="font-ligatures-row"
				control={
					<WithReset
						dirty={codeLigatures !== DEFAULT_FONT_PREFERENCE.codeLigatures}
						label={t("settings.appearance.fonts.resetLigatures")}
						onReset={() =>
							void saveSettings({ codeLigatures: DEFAULT_FONT_PREFERENCE.codeLigatures }, failure)
						}
					>
						<SettingsSwitch
							checked={codeLigatures}
							label={t("settings.appearance.fonts.ligatures")}
							testId="font-ligatures"
							onChange={(next) => void saveSettings({ codeLigatures: next }, failure)}
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
				<div className={cn(SETTINGS_ROWS_CONTAINER, "pb-12")}>
					{fallbackRow("interface")}
					{fallbackRow("code")}
				</div>
			</SettingsDisclosure>
		</SettingsGroup>
	);
}
