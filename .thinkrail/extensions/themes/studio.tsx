import {
	cn,
	remixicon,
	ui,
	useAction,
	useChannel,
	useHostContext,
	useTheme,
} from "@thinkrail/ext/view";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import manifest from "./extension.json";
import {
	COLOR_FIELDS,
	type ColorToken,
	DRAFT_KEY,
	type Draft,
	draftFromTokens,
	draftTokens,
	PALETTE_TOKENS,
	parseDraft,
	RADIUS_MAX,
	RADIUS_MIN,
	themeSnippet,
	toHex6,
	withColor,
} from "./model";

const { RiCheckLine, RiFileCopyLine, RiPaletteLine, RiSaveLine, RiStopCircleLine } = remixicon;

const THEMES = manifest.themes.map((theme) => ({
	...theme,
	mode: theme.mode === "light" ? ("light" as const) : ("dark" as const),
}));

const readCurrent = (mode: Draft["mode"]): Draft => {
	const style = getComputedStyle(document.documentElement);
	const tokens = Object.fromEntries(
		[...PALETTE_TOKENS, "--radius-sm"].map((token) => [token, style.getPropertyValue(token)]),
	);
	return draftFromTokens({ title: "My theme", mode, tokens });
};

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
	<section className="flex flex-col gap-8 border-b border-border-muted px-12 py-12">
		<h3 className="tr-text-metadata text-text-subtle">{title}</h3>
		{children}
	</section>
);

const Studio = () => {
	const theme = useTheme();
	const host = useHostContext();
	const saved = parseDraft(useChannel<unknown>(DRAFT_KEY));
	const saveDraft = useAction("saveDraft");
	const [draft, setDraft] = useState<Draft>(() => saved ?? readCurrent(host.theme));
	const [live, setLive] = useState(false);
	const [errors, setErrors] = useState<string[]>([]);
	const [copied, setCopied] = useState(false);
	const { preview } = theme;
	const previewRef = useRef(preview);
	previewRef.current = preview;
	const snippet = useMemo(() => themeSnippet(draft), [draft]);

	const pendingRef = useRef(draft);
	const frameRef = useRef<number | null>(null);
	const cancelFrame = () => {
		if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
		frameRef.current = null;
	};

	useEffect(() => {
		if (!live) return;
		pendingRef.current = draft;
		if (frameRef.current !== null) return;
		frameRef.current = requestAnimationFrame(() => {
			frameRef.current = null;
			const next = pendingRef.current;
			const result = previewRef.current({ mode: next.mode, tokens: draftTokens(next) });
			if (result.ok) {
				setErrors((current) => (current.length === 0 ? current : []));
				return;
			}
			setErrors(result.errors);
			setLive(false);
		});
	}, [draft, live]);

	useEffect(
		() => () => {
			if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
			previewRef.current(null);
		},
		[],
	);

	const edit = (next: Partial<Draft>) => {
		setDraft((current) => ({ ...current, ...next }));
		setLive(true);
		setCopied(false);
	};
	const setColor = (token: ColorToken, value: string) => {
		setDraft((current) => withColor(current, token, value));
		setLive(true);
		setCopied(false);
	};
	const stop = () => {
		cancelFrame();
		setLive(false);
		preview(null);
	};
	const copy = () =>
		navigator.clipboard.writeText(snippet).then(
			() => setCopied(true),
			() => setErrors(["Clipboard is not available here. Copy the JSON below by hand."]),
		);

	return (
		<div
			data-testid="theme-studio"
			className="flex h-full min-h-0 flex-col bg-container-workspace-bg"
		>
			<header className="flex shrink-0 items-center gap-8 border-b border-border-muted px-12 py-8">
				<RiPaletteLine className="size-16 shrink-0 text-primary" />
				<h2 className="tr-title-compact text-text-default">Theme studio</h2>
				{theme.previewing ? (
					<span
						data-testid="theme-studio-previewing"
						className="rounded-[var(--radius-sm)] bg-primary-subtle px-4 tr-text-metadata text-primary"
					>
						Previewing
					</span>
				) : null}
				<span className="ml-auto" />
				{theme.previewing ? (
					<ui.Button variant="outline" size="sm" data-testid="theme-studio-stop" onClick={stop}>
						<RiStopCircleLine className="size-14" /> Stop preview
					</ui.Button>
				) : null}
			</header>
			<div data-testid="theme-studio-body" className="min-h-0 flex-1 overflow-y-auto">
				<Section title="Themes in this extension">
					<ul className="flex flex-col gap-4">
						{THEMES.map((item) => {
							const active = theme.active?.id === item.id;
							return (
								<li key={item.id} className="flex items-center gap-8">
									<span className="tr-text-ui text-text-default">{item.title}</span>
									<span className="tr-text-metadata text-text-subtle">{item.mode}</span>
									<span className="ml-auto" />
									<ui.Button
										variant="ghost"
										size="sm"
										data-testid={`theme-studio-edit-${item.id}`}
										onClick={() =>
											edit(
												draftFromTokens({
													title: `${item.title} copy`,
													mode: item.mode,
													tokens: item.tokens,
												}),
											)
										}
									>
										Edit copy
									</ui.Button>
									<ui.Button
										variant={active ? "default" : "outline"}
										size="sm"
										data-testid={`theme-studio-use-${item.id}`}
										onClick={() => theme.select(active ? null : item.id)}
									>
										{active ? <RiCheckLine className="size-14" /> : null}
										{active ? "In use" : "Use"}
									</ui.Button>
								</li>
							);
						})}
					</ul>
				</Section>
				<Section title="Edit">
					<div className="flex items-center gap-8">
						<ui.Input
							aria-label="Theme name"
							data-testid="theme-studio-title"
							value={draft.title}
							maxLength={60}
							onChange={(event) => edit({ title: event.target.value })}
						/>
						{(["light", "dark"] as const).map((mode) => (
							<ui.Button
								key={mode}
								variant={draft.mode === mode ? "default" : "outline"}
								size="sm"
								data-testid={`theme-studio-mode-${mode}`}
								onClick={() => edit({ mode })}
							>
								{mode === "light" ? "Light" : "Dark"}
							</ui.Button>
						))}
					</div>
					<div className="grid grid-cols-2 gap-8">
						{COLOR_FIELDS.map(({ token, label }) => (
							<label
								key={token}
								className="flex items-center gap-8 rounded-[var(--radius-sm)] border border-border-muted px-8 py-4"
							>
								<input
									type="color"
									data-testid={`theme-studio-color${token.slice(1)}`}
									value={toHex6(draft.colors[token] ?? "") ?? "#000000"}
									onChange={(event) => setColor(token, event.target.value)}
									className="size-24 shrink-0 cursor-pointer rounded-[var(--radius-sm)] border border-border-default bg-transparent"
								/>
								<span className="flex min-w-0 flex-col">
									<span className="tr-text-ui text-text-default">{label}</span>
									<span className="tr-code-text text-text-subtle">
										{draft.colors[token] ?? "unset"}
									</span>
								</span>
							</label>
						))}
					</div>
					<label className="flex items-center gap-8">
						<span className="tr-text-ui text-text-default">Corner radius</span>
						<input
							type="range"
							data-testid="theme-studio-radius"
							min={RADIUS_MIN}
							max={RADIUS_MAX}
							step={1}
							value={draft.radius}
							onChange={(event) => edit({ radius: Number(event.target.value) })}
							className="flex-1 accent-primary"
						/>
						<span className="w-40 text-right tr-code-text text-text-muted">{draft.radius}px</span>
					</label>
					<div className="flex items-center gap-8 rounded-[var(--radius-md)] border border-border-default bg-container-elevated-bg p-12">
						<ui.Button size="sm">Primary</ui.Button>
						<ui.Button size="sm" variant="outline">
							Outline
						</ui.Button>
						<span className="tr-text-ui text-text-default">Text</span>
						<span className="tr-text-ui text-text-muted">muted</span>
					</div>
					{errors.length > 0 ? (
						<p data-testid="theme-studio-error" className="tr-text-metadata text-feedback-error">
							{errors.join("; ")}
						</p>
					) : null}
				</Section>
				<Section title="Export">
					<div className="flex items-center gap-8">
						<ui.Button
							variant="outline"
							size="sm"
							data-testid="theme-studio-copy"
							onClick={() => void copy()}
						>
							{copied ? (
								<RiCheckLine className="size-14" />
							) : (
								<RiFileCopyLine className="size-14" />
							)}
							{copied ? "Copied" : "Copy JSON"}
						</ui.Button>
						<ui.Button
							variant="ghost"
							size="sm"
							data-testid="theme-studio-save"
							onClick={() => void saveDraft(draft)}
						>
							<RiSaveLine className="size-14" /> Save draft
						</ui.Button>
						<span className="tr-text-metadata text-text-muted">
							Paste into the <code className="tr-code-text">themes</code> array of an
							extension.json.
						</span>
					</div>
					<pre
						data-testid="theme-studio-snippet"
						className={cn(
							"max-h-[240px] overflow-auto rounded-[var(--radius-sm)] border border-border-muted bg-container-content-bg p-8",
							"tr-code-text text-text-default",
						)}
					>
						{snippet}
					</pre>
				</Section>
			</div>
		</div>
	);
};

export default Studio;
