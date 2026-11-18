import { useT } from "@thinkrail/locales/react";
import { useLocalKeys } from "@thinkrail/ui/local-keys";
import { cn } from "@thinkrail/ui/utils";
import { Fragment, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { LOCAL_KEY_DEFAULTS } from "@/keybindings";
import { navAction, navIndex } from "@/settingsKit";
import { SettingsSection } from "@/store";
import type { SettingsNavGroup } from "./settingsNav";

export const SETTINGS_PANEL_ID = "settings-panel";

export const settingsTabId = (section: SettingsSection) => `settings-tab-${section}`;

export function settingsTabOrder(groups: readonly SettingsNavGroup[]): SettingsSection[] {
	return [
		...groups.flatMap((group) => group.sections.map((section) => section.id)),
		SettingsSection.Feedback,
	];
}

export interface SettingsTabsProps {
	readonly groups: readonly SettingsNavGroup[];
	readonly selected: SettingsSection;
	readonly searching: boolean;
	readonly onSelect: (section: SettingsSection) => void;
	readonly onEnter: () => void;
	readonly onSearch: () => void;
	readonly ref?: Ref<HTMLDivElement>;
}

const TAB =
	"flex shrink-0 items-center gap-4 rounded-sm px-8 py-4 text-left tr-text-ui transition-colors focus-visible:focus-ring-inset md:min-h-28 md:w-full md:py-0";

export function SettingsTabs({
	groups,
	selected,
	searching,
	onSelect,
	onEnter,
	onSearch,
	ref,
}: SettingsTabsProps) {
	const t = useT();
	const keys = useLocalKeys("settings.nav", LOCAL_KEY_DEFAULTS["settings.nav"]);
	const order = settingsTabOrder(groups);

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.defaultPrevented) return;
		if (!(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "tab")
			return;
		const action = navAction(event.nativeEvent, keys.match(event.nativeEvent));
		if (action === null) return;
		event.preventDefault();
		if (action.kind === "enter") return onEnter();
		if (action.kind === "search") return onSearch();
		const index = navIndex(action, order.indexOf(selected), order.length);
		const next = index === null ? undefined : order[index];
		if (next === undefined) return;
		onSelect(next);
		event.currentTarget.querySelector<HTMLElement>(`#${settingsTabId(next)}`)?.focus();
	};

	const tab = (id: SettingsSection, content: ReactNode, feedback = false) => {
		const active = id === selected;
		return (
			<button
				key={id}
				type="button"
				role="tab"
				id={settingsTabId(id)}
				aria-selected={active}
				aria-controls={SETTINGS_PANEL_ID}
				tabIndex={active ? 0 : -1}
				data-testid={`settings-nav-${id}`}
				data-active={active}
				onClick={() => onSelect(id)}
				className={cn(
					TAB,
					feedback && "text-primary",
					active && !searching && "bg-primary-subtle text-primary",
					active && searching && "bg-control-bg text-primary",
					!active && !feedback && "text-text-muted hover:text-text-default",
					!active && "hover:bg-control-bg-hovered",
				)}
			>
				{content}
			</button>
		);
	};

	return (
		<div
			ref={ref}
			role="tablist"
			aria-orientation="vertical"
			aria-label={t("settings.dialog.sectionsLabel")}
			data-key-scope="settings.nav"
			onKeyDown={onKeyDown}
			className="flex min-h-0 gap-4 overflow-x-auto px-8 pb-8 md:flex-1 md:flex-col md:gap-2 md:overflow-x-visible md:overflow-y-auto md:pb-12"
		>
			{groups.map((group) => (
				<Fragment key={group.label}>
					<div
						role="presentation"
						className="hidden shrink-0 px-8 pt-12 pb-4 tr-text-label-pill text-text-subtle uppercase md:block"
					>
						{t(group.label)}
					</div>
					{group.sections.map(({ id, label, icon: Icon }) =>
						tab(
							id,
							<>
								<Icon aria-hidden className="size-14 shrink-0" />
								<span className="min-w-0 wrap-anywhere">{t(label)}</span>
							</>,
						),
					)}
				</Fragment>
			))}
			<div
				role="presentation"
				className="hidden shrink-0 border-border-default border-t md:mt-auto md:mb-4 md:block"
			/>
			{tab(
				SettingsSection.Feedback,
				<span className="min-w-0 wrap-anywhere">{t("settings.dialog.feedbackCta")}</span>,
				true,
			)}
		</div>
	);
}
