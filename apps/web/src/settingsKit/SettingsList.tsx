import { isContextMenuKey } from "@thinkrail/ui/context-menu";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { useLocalKeys } from "@thinkrail/ui/local-keys";
import { createContext, type KeyboardEvent, type ReactNode, use, useMemo, useState } from "react";
import { LOCAL_KEY_DEFAULTS } from "../keybindings";

export const SETTINGS_LIST_ROW =
	"flex min-h-40 items-center gap-8 border-border-muted border-b py-6 last:border-b-0";

export const SETTINGS_LIST_PRIMARY =
	"flex min-w-0 flex-1 flex-col items-start gap-2 rounded-sm px-4 py-2 text-left transition-colors hover:bg-control-bg-hovered focus-visible:focus-ring";

interface ListScope {
	readonly list: string;
	readonly active: string | null;
	readonly setActive: (id: string) => void;
}

const SettingsListContext = createContext<ListScope | null>(null);

const ROW = "[data-focus-row]";

export function activeListRow(rowIds: readonly string[], focused: string | null): string | null {
	return focused !== null && rowIds.includes(focused) ? focused : (rowIds[0] ?? null);
}

export interface SettingsListProps {
	focusList: string;
	label: string;
	rowIds: readonly string[];
	settingId?: string | undefined;
	testId?: string;
	onRemove?: ((rowId: string) => void) | undefined;
	onMenu?: ((rowId: string) => void) | undefined;
	children: ReactNode;
}

export function SettingsList({
	focusList,
	label,
	rowIds,
	settingId,
	testId,
	onRemove,
	onMenu,
	children,
}: SettingsListProps) {
	const keys = useLocalKeys("settings.list", LOCAL_KEY_DEFAULTS["settings.list"]);
	const [focused, setFocused] = useState<string | null>(null);
	const active = activeListRow(rowIds, focused);
	const scope = useMemo(
		() => ({ list: focusList, active, setActive: setFocused }),
		[focusList, active],
	);

	const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
		if (event.defaultPrevented || isImeComposing(event.nativeEvent)) return;
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		const row = target.closest<HTMLElement>(ROW);
		const rowId = row?.dataset.focusRow;
		if (!row || rowId === undefined || !event.currentTarget.contains(row)) return;
		if (isContextMenuKey(event)) {
			if (!onMenu) return;
			event.preventDefault();
			onMenu(rowId);
			return;
		}
		if (keys.match(event.nativeEvent) === "settings.list.remove") {
			if (!onRemove) return;
			event.preventDefault();
			onRemove(rowId);
			return;
		}
		const plain = !(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey);
		if (event.key !== " " || !plain || !target.hasAttribute("data-focus-row-primary")) return;
		const toggle = row.querySelector<HTMLElement>('[role="switch"]');
		if (!toggle) return;
		event.preventDefault();
		toggle.click();
	};

	return (
		<SettingsListContext value={scope}>
			<ul
				aria-label={label}
				data-key-scope="settings.list"
				data-focus-list={focusList}
				data-setting-id={settingId}
				data-testid={testId}
				className="flex flex-col"
				onKeyDown={onKeyDown}
			>
				{children}
			</ul>
		</SettingsListContext>
	);
}

export function useSettingsListRow(id: string) {
	const scope = use(SettingsListContext);
	const tabIndex = scope?.active === id ? 0 : -1;
	return {
		rowProps: {
			"data-setting-row": scope ? `${scope.list}/${id}` : id,
			"data-focus-row": id,
			onFocus: () => scope?.setActive(id),
		},
		primaryProps: { tabIndex, "data-focus-row-primary": "", "data-setting-stop": "" },
		sideProps: { tabIndex, "data-setting-side": "" },
	} as const;
}
