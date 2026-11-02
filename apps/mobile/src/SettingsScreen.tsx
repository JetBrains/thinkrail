import { RiComputerLine } from "@remixicon/react";
import { BUNDLED_LOCALES, languageName, resolveLocale, SYSTEM_LOCALE } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import type { SavedHost } from "@thinkrail/remote-client";
import { Button } from "@thinkrail/ui/button";
import {
	SegmentedControl,
	type SegmentedControlOption,
	SettingsGroup,
	SettingsPageContainer,
	SettingsRadioCards,
	type SettingsRadioChoice,
	SettingsRow,
} from "@thinkrail/ui/settings";
import { useState } from "react";
import type { PairState } from "./App";
import { failureText, type HostStatus } from "./hostStatus";
import { Screen } from "./layout";
import { PairActions } from "./PairForm";
import type { ContrastChoice, DevicePreferences, ThemeChoice } from "./preferences";
import { BRAND } from "./Welcome";

/** The phone's settings: its paired computers and pairing another, then the IDE Settings rows that make sense on a device (theme, language), kept on the device. */
export function SettingsScreen({
	hosts,
	statusOf,
	onReconnect,
	onForget,
	pair,
	onPair,
	preferences,
	onChange,
	backLabel,
	onBack,
}: {
	hosts: SavedHost[];
	statusOf: (hostKey: string) => HostStatus;
	onReconnect: (host: SavedHost) => void;
	onForget: (hostKey: string) => void;
	pair: PairState;
	onPair: (link: string) => Promise<boolean>;
	preferences: DevicePreferences;
	onChange: (preferences: DevicePreferences) => void;
	backLabel: string;
	onBack: () => void;
}) {
	const t = useT();
	const themeOptions: SegmentedControlOption<ThemeChoice>[] = [
		{ id: "system", label: t("settings.appearance.mode.system"), testId: "theme-mode-system" },
		{ id: "light", label: t("settings.appearance.mode.light"), testId: "theme-mode-light" },
		{ id: "dark", label: t("settings.appearance.mode.dark"), testId: "theme-mode-dark" },
	];
	const contrastOptions: SegmentedControlOption<ContrastChoice>[] = [
		{ id: "normal", label: t("common.default"), testId: "contrast-default" },
		{ id: "high", label: t("settings.appearance.contrast.high"), testId: "contrast-high" },
	];
	const systemTag = resolveLocale(SYSTEM_LOCALE, BUNDLED_LOCALES, navigator.languages);
	const languages: SettingsRadioChoice<string>[] = [
		{
			id: SYSTEM_LOCALE,
			label: t("settings.language.system.label"),
			description: t("settings.language.system.description", {
				language: languageName(systemTag),
			}),
			testId: "language-system",
		},
		...BUNDLED_LOCALES.map((tag) => ({ tag, name: languageName(tag) }))
			.sort((a, b) => a.name.localeCompare(b.name))
			.map(
				({ tag, name }): SettingsRadioChoice<string> => ({
					id: tag,
					label: name,
					description: tag,
					testId: `language-${tag}`,
				}),
			),
	];

	return (
		<Screen title={t("settings.dialog.title")} back={{ label: backLabel, onBack }}>
			<div className="p-16">
				<section className="mb-24 flex flex-col items-center gap-8 rounded-lg border border-border-default bg-container-elevated-bg px-16 py-40 text-center">
					<span className="text-primary tr-brand-hero">{BRAND}</span>
					<span className="text-text-muted tr-text-ui">{t("mobile.welcome.tagline")}</span>
				</section>
				<SettingsPageContainer testId="mobile-settings">
					<SettingsGroup
						title={t("mobile.settings.computers")}
						description={t("mobile.projects.addHint")}
					>
						{hosts.map((host) => (
							<ComputerRow
								key={host.hostKey}
								host={host}
								status={statusOf(host.hostKey)}
								onReconnect={() => onReconnect(host)}
								onForget={() => onForget(host.hostKey)}
							/>
						))}
						<div className="pt-12">
							<PairActions pair={pair} onPair={onPair} />
						</div>
					</SettingsGroup>
					<SettingsGroup title={t("settings.appearance.themeGroup")}>
						<SettingsRow
							label={t("settings.appearance.themeMode")}
							control={
								<SegmentedControl
									name="theme-mode"
									label={t("settings.appearance.themeMode")}
									options={themeOptions}
									value={preferences.theme}
									onSelect={(theme) => onChange({ ...preferences, theme })}
								/>
							}
						/>
						<SettingsRow
							label={t("settings.appearance.contrastLevel")}
							control={
								<SegmentedControl
									name="contrast"
									label={t("settings.appearance.contrastLevel")}
									options={contrastOptions}
									value={preferences.contrast}
									onSelect={(contrast) => onChange({ ...preferences, contrast })}
								/>
							}
						/>
					</SettingsGroup>
					<SettingsGroup
						title={t("settings.language.title")}
						description={t("settings.language.description")}
					>
						<SettingsRadioCards
							name="ui-language"
							label={t("settings.language.title")}
							choices={languages}
							value={
								languages.some((choice) => choice.id === preferences.locale)
									? preferences.locale
									: SYSTEM_LOCALE
							}
							onSelect={(locale) => onChange({ ...preferences, locale })}
						/>
					</SettingsGroup>
				</SettingsPageContainer>
			</div>
		</Screen>
	);
}

/** A paired computer: its name, whether it is reachable now, and the reconnect / forget actions. */
function ComputerRow({
	host,
	status,
	onReconnect,
	onForget,
}: {
	host: SavedHost;
	status: HostStatus;
	onReconnect: () => void;
	onForget: () => void;
}) {
	const t = useT();
	const [confirming, setConfirming] = useState(false);
	const detail =
		status.kind === "connected"
			? t("mobile.hosts.connected")
			: status.kind === "connecting"
				? t("mobile.hosts.connecting")
				: failureText(t, status.failure);
	return (
		<div
			data-testid="settings-computer"
			className="flex flex-col gap-8 border-b border-border-muted py-12"
		>
			<div className="flex items-start gap-12">
				<RiComputerLine aria-hidden className="mt-2 size-20 shrink-0 text-text-muted" />
				<div className="flex min-w-0 flex-1 flex-col gap-2">
					<span className="truncate text-text-default tr-text-ui">{host.label}</span>
					<span
						className={
							status.kind === "unreachable"
								? "text-feedback-warning tr-text-metadata"
								: "text-text-muted tr-text-metadata"
						}
					>
						{detail}
					</span>
				</div>
			</div>
			{confirming ? (
				<div className="flex flex-col gap-8 pl-32">
					<p className="m-0 text-text-default tr-text-metadata">
						{t("mobile.hosts.forgetConfirm", { host: host.label })}
					</p>
					<div className="flex gap-8">
						<Button
							variant="outline"
							className="h-touch flex-1 rounded-md"
							onClick={() => setConfirming(false)}
						>
							{t("mobile.pair.cancel")}
						</Button>
						<Button
							variant="outline"
							tone="danger"
							className="h-touch flex-1 rounded-md"
							onClick={onForget}
						>
							{t("mobile.hosts.forget")}
						</Button>
					</div>
				</div>
			) : (
				<div className="flex gap-8 pl-32">
					{status.kind === "unreachable" ? (
						<Button variant="outline" className="h-touch rounded-md" onClick={onReconnect}>
							{t("mobile.hosts.reconnect")}
						</Button>
					) : null}
					<Button
						variant="ghost"
						tone="danger"
						className="h-touch rounded-md"
						onClick={() => setConfirming(true)}
					>
						{t("mobile.hosts.forget")}
					</Button>
				</div>
			)}
		</div>
	);
}
