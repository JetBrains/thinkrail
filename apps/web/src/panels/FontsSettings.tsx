import {
	CODE_FONT_SIZE,
	FONT_WEIGHT_OFFSET,
	type FontChoice,
	type FontRole,
} from "@thinkrail/contracts";
import { T, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Switch } from "@thinkrail/ui/switch";
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
import {
	SettingsGroup,
	SettingsNotice,
	SettingsNumberField,
	SettingsRow,
	SettingsSlider,
	useSettingsDraft,
} from "@/settingsKit";
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
import { saveSettings } from "./saveSettings";
import { useConfigReset } from "./settingDefaults";
import { SETTING, settingProps } from "./settingsCatalog";

const CODE_BLOCK_SAMPLE =
	"const stack = fonts.code ?? defaults.code;\nif (size !== 13 && stack.length >= 1) apply(stack); // => -> <=";
const EDITOR_SAMPLE = [
	"export function apply(fonts: FontSettings) {",
	"  const code = fonts.code ?? DEFAULT_CODE;",
	'  return code.length >= 1 && code[0] !== "" ? code : null;',
	"}",
];
const TERMINAL_SAMPLE = ["~/thinkrail main ❯ bun run test", " ✓ 128 passed (1.42 s)"];

const FONT_ENTRIES = { interface: SETTING.interfaceFont, code: SETTING.codeFont } as const;
const FALLBACK_ENTRIES = {
	interface: SETTING.interfaceFallbacks,
	code: SETTING.codeFallbacks,
} as const;

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
			<div className="flex flex-wrap gap-8">
				<Button variant="soft-primary" size="m" tabIndex={-1}>
					{t("settings.appearance.fonts.preview.openPr")}
				</Button>
				<Button variant="outline" size="m" tabIndex={-1}>
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

function useFontCatalog() {
	const userFonts = useAppStore((state) => state.userFonts);
	const [installed, setInstalled] = useState<InstalledFonts>({ status: "idle" });
	const installedRequestRef = useRef(0);
	const [faces] = useState(bundledFaces);
	const [shares] = useState(sharesHostFonts);
	const facesRevision = useSyncExternalStore(subscribeFontFaces, fontFacesRevision);
	const probe = (family: string) => probeFont(family, facesRevision);
	const custom = customFamilies(userFonts);

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

	return {
		faces,
		shares,
		facesRevision,
		probe,
		installed,
		options: fontOptions({ faces, custom, installed, probe }),
		renders: (family: string) => custom.has(family) || probe(family).renders,
		readInstalled,
	};
}

type FontCatalog = ReturnType<typeof useFontCatalog>;

function useFontChoice(role: FontRole) {
	const t = useT();
	const choice = useAppStore((state) =>
		role === "interface" ? state.interfaceFont : state.codeFont,
	);
	const [pending, setPending] = useState(false);
	const save = (next: FontChoice) => {
		if (pending) return;
		setPending(true);
		void saveSettings(
			role === "interface" ? { interfaceFont: next } : { codeFont: next },
			t("settings.appearance.fonts.changeFailed"),
		).then(() => setPending(false));
	};
	return { role, choice, pending, save };
}

type FontChoiceState = ReturnType<typeof useFontChoice>;

function namedFamily(choice: FontChoice): string | null {
	const ref = choice.family;
	return ref !== null && "name" in ref ? ref.name : null;
}

function pickerProps(catalog: FontCatalog, font: FontChoiceState) {
	return {
		role: font.role,
		installed: catalog.installed,
		probe: catalog.probe,
		sharesHostFonts: catalog.shares,
		disabled: font.pending,
		onOpen: catalog.readInstalled,
		onRetry: catalog.readInstalled,
		testId: `font-${font.role}`,
	};
}

function FontRow({ catalog, font }: { catalog: FontCatalog; font: FontChoiceState }) {
	const t = useT();
	const { role, choice } = font;
	const family = roleFamily(choice.family, role, catalog.faces);
	const named = namedFamily(choice);
	const unavailable = named !== null && !catalog.renders(named);
	const shown = displayFamily(family);
	return (
		<>
			<SettingsRow
				{...settingProps(t, FONT_ENTRIES[role])}
				testId={`font-${role}-row`}
				control={
					<FontPicker
						{...pickerProps(catalog, font)}
						label={
							role === "interface"
								? t("settings.appearance.fonts.interfaceFontValue", { family: shown })
								: t("settings.appearance.fonts.codeFontValue", { family: shown })
						}
						options={mainFontOptions(catalog.options, role, catalog.shares)}
						family={family}
						value={choice.family}
						unavailable={unavailable}
						onSelect={(ref) => font.save({ ...choice, family: ref })}
					/>
				}
				reset={{
					changed: choice.family !== null,
					onReset: () => font.save({ ...choice, family: null }),
				}}
			/>
			{unavailable ? (
				<div className="border-border-muted border-b py-12">
					<SettingsNotice variant="warning" testId={`font-${role}-unavailable`}>
						{t("settings.appearance.fonts.unavailable", {
							family: shown,
							fallback: displayFamily(catalog.faces[role]),
						})}
					</SettingsNotice>
				</div>
			) : null}
		</>
	);
}

function FallbackRow({ catalog, font }: { catalog: FontCatalog; font: FontChoiceState }) {
	const t = useT();
	const { role, choice } = font;
	return (
		<SettingsRow
			{...settingProps(t, FALLBACK_ENTRIES[role])}
			testId={`font-${role}-fallbacks-row`}
			control={
				<FallbackChips
					{...pickerProps(catalog, font)}
					testId={`font-${role}-fallbacks`}
					options={fallbackFontOptions(catalog.options, [
						...(choice.family ? [choice.family] : [{ builtin: role }]),
						...choice.fallbacks,
					])}
					values={choice.fallbacks}
					familyOf={(ref) => refFamily(ref, catalog.faces)}
					addLabel={
						role === "interface"
							? t("settings.appearance.fonts.addInterfaceFallback")
							: t("settings.appearance.fonts.addCodeFallback")
					}
					onChange={(fallbacks) => font.save({ ...choice, fallbacks })}
				/>
			}
			reset={{
				changed: choice.fallbacks.length > 0,
				onReset: () => font.save({ ...choice, fallbacks: [] }),
			}}
		/>
	);
}

function WeightRow({
	value,
	hints,
	onCommit,
}: {
	value: number;
	hints: ReactNode[];
	onCommit: (next: number) => Promise<boolean>;
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
	const shown = offset === 0 ? t("common.default") : offset > 0 ? `+${offset}` : `−${-offset}`;
	return (
		<>
			<SettingsRow
				{...settingProps(t, SETTING.textWeight)}
				testId="font-weight"
				control={
					<div className="flex items-center gap-8 text-text-muted tr-text-metadata">
						<span>{t("settings.appearance.fonts.weightLighter")}</span>
						<div className="w-160">
							<SettingsSlider
								label={t("settings.appearance.fonts.weight")}
								valueText={shown}
								value={offset}
								min={FONT_WEIGHT_OFFSET.min}
								max={FONT_WEIGHT_OFFSET.max}
								step={FONT_WEIGHT_OFFSET.step}
								marker={FONT_WEIGHT_OFFSET.default}
								testId="font-weight-input"
								onChange={(next) => {
									setDraft(String(next));
									previewFontWeightOffset(next);
								}}
								onCommit={commitDraft}
							/>
						</div>
						<span>{t("settings.appearance.fonts.weightHeavier")}</span>
						<span
							data-testid="font-weight-value"
							className="w-64 text-right text-text-default tr-text-ui"
						>
							{shown}
						</span>
					</div>
				}
				reset={{
					changed: value !== DEFAULT_FONT_PREFERENCE.fontWeightOffset,
					onReset: () => {
						previewFontWeightOffset(DEFAULT_FONT_PREFERENCE.fontWeightOffset);
						submit(String(DEFAULT_FONT_PREFERENCE.fontWeightOffset));
					},
				}}
			/>
			{hints.length > 0 ? (
				<div className="flex flex-col gap-4 border-border-muted border-b py-12">{hints}</div>
			) : null}
		</>
	);
}

export function InterfaceFontsGroup() {
	const t = useT();
	const catalog = useFontCatalog();
	const font = useFontChoice("interface");
	const codeFont = useAppStore((state) => state.codeFont);
	const fontWeightOffset = useAppStore((state) => state.fontWeightOffset);
	const renderedNamed = [
		...new Set(
			[font.choice, codeFont].flatMap((choice) => {
				const named = namedFamily(choice);
				return named !== null && catalog.renders(named) ? [named] : [];
			}),
		),
	];
	const weightResponses = useWeightResponses(renderedNamed, catalog.facesRevision);
	const weightHints = renderedNamed.flatMap((family) => {
		const response = weightResponses[family];
		if (response === undefined || response === "smooth") return [];
		return [
			<SettingsNotice key={family} variant="info" testId="font-weight-hint">
				{response === "fixed"
					? t("settings.appearance.fonts.weightFixed", {
							family,
							interface: displayFamily(catalog.faces.interface),
							code: displayFamily(catalog.faces.code),
						})
					: t("settings.appearance.fonts.weightSteps", { family })}
			</SettingsNotice>,
		];
	});
	return (
		<SettingsGroup
			title={t("settings.appearance.fonts.interface.title")}
			description={t("settings.appearance.fonts.description")}
			testId="font-interface-group"
		>
			<FontRow catalog={catalog} font={font} />
			<WeightRow
				value={fontWeightOffset}
				hints={weightHints}
				onCommit={(next) =>
					saveSettings({ fontWeightOffset: next }, t("settings.appearance.fonts.changeFailed"))
				}
			/>
			<FallbackRow catalog={catalog} font={font} />
		</SettingsGroup>
	);
}

export function CodeFontsGroup() {
	const t = useT();
	const catalog = useFontCatalog();
	const font = useFontChoice("code");
	const codeFontSize = useAppStore((state) => state.codeFontSize);
	const codeLigatures = useAppStore((state) => state.codeLigatures);
	const sizeReset = useConfigReset("codeFontSize", "settings.appearance.fonts.changeFailed");
	const ligaturesReset = useConfigReset("codeLigatures", "settings.appearance.fonts.changeFailed");
	const failure = t("settings.appearance.fonts.changeFailed");
	return (
		<SettingsGroup title={t("settings.appearance.fonts.code.title")} testId="font-code-group">
			<FontRow catalog={catalog} font={font} />
			<SettingsRow
				{...settingProps(t, SETTING.codeSize)}
				description={t("settings.appearance.fonts.sizeDescription", {
					delta: CODE_FONT_SIZE.editorDelta,
				})}
				testId="font-code-size"
				control={
					<SettingsNumberField
						label={t("settings.appearance.fonts.sizeInput")}
						value={codeFontSize}
						min={CODE_FONT_SIZE.min}
						max={CODE_FONT_SIZE.max}
						unit={t("settings.appearance.fonts.sizeUnit")}
						testId="font-code-size-input"
						onCommit={(size) => saveSettings({ codeFontSize: size }, failure)}
					/>
				}
				reset={sizeReset}
			/>
			<SettingsRow
				{...settingProps(t, SETTING.ligatures)}
				testId="font-ligatures-row"
				control={
					<Switch
						checked={codeLigatures}
						label={t("settings.appearance.fonts.ligatures")}
						testId="font-ligatures"
						tabIndex={0}
						onCheckedChange={(next) => void saveSettings({ codeLigatures: next }, failure)}
					/>
				}
				reset={ligaturesReset}
			/>
			<FallbackRow catalog={catalog} font={font} />
			<div className="py-12">
				<FontPreview codeFontSize={codeFontSize} />
			</div>
		</SettingsGroup>
	);
}
