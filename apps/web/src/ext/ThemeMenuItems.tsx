import { RiCheckLine, RiPaletteLine } from "@remixicon/react";
import type { ExtensionInfo } from "@thinkrail/contracts";
import { useMemo } from "react";
import {
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
} from "../components/ui/dropdown-menu";
import { useExtStore } from "./extStore";
import { findTheme, selectThemes } from "./extThemes";

const BUILT_IN = "builtin";

const Mark = ({ on }: { on: boolean }) =>
	on ? <RiCheckLine className="size-14 text-primary" /> : <span className="size-14" />;

export const ThemeMenuItems = ({
	extensions,
	separated,
}: {
	extensions: Record<string, ExtensionInfo>;
	separated: boolean;
}) => {
	const selection = useExtStore((state) => state.themeSelection);
	const selectThemeKey = useExtStore((state) => state.selectTheme);
	const themes = useMemo(() => selectThemes(extensions), [extensions]);
	if (themes.length === 0) return null;
	const active = findTheme(extensions, selection)?.key ?? BUILT_IN;
	return (
		<>
			{separated ? <DropdownMenuSeparator /> : null}
			<DropdownMenuLabel
				data-testid="ext-menu-themes"
				className="flex items-center gap-4 tr-text-metadata text-text-subtle"
			>
				<RiPaletteLine className="size-14" />
				Theme
			</DropdownMenuLabel>
			<DropdownMenuRadioGroup
				value={active}
				onValueChange={(value) => selectThemeKey(value === BUILT_IN ? null : value)}
			>
				<DropdownMenuRadioItem value={BUILT_IN} data-testid="ext-theme-builtin">
					<Mark on={active === BUILT_IN} />
					Built-in (Settings)
				</DropdownMenuRadioItem>
				{themes.map(({ key, extension, theme }) => (
					<DropdownMenuRadioItem
						key={key}
						value={key}
						data-testid={`ext-theme-${extension.name}-${theme.id}`}
						data-active={active === key}
					>
						<Mark on={active === key} />
						{theme.title}
						<span className="ml-auto pl-12 text-text-subtle">
							{extension.title} · {theme.mode}
						</span>
					</DropdownMenuRadioItem>
				))}
			</DropdownMenuRadioGroup>
		</>
	);
};
