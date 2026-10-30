import { RiArrowDownSLine, RiCheckLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { useState } from "react";

const THEMES = {
	dark: "settings.appearance.themeName.dark",
	minimalDark: "settings.appearance.themeName.minimalDark",
	highContrastDark: "settings.appearance.themeName.highContrastDark",
} as const;
type ThemeId = keyof typeof THEMES;
const isTheme = (value: string): value is ThemeId => value in THEMES;

export default function SingleChoice() {
	const t = useT();
	const [theme, setTheme] = useState<ThemeId>("dark");
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="outline"
					size="l"
					iconRight={RiArrowDownSLine}
					aria-label={t("settings.appearance.darkThemeTrigger", { theme: t(THEMES[theme]) })}
				>
					<span className="truncate">{t(THEMES[theme])}</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-[var(--radix-dropdown-menu-trigger-width)]">
				<DropdownMenuRadioGroup
					value={theme}
					onValueChange={(value) => {
						if (isTheme(value)) setTheme(value);
					}}
				>
					{(Object.keys(THEMES) as ThemeId[]).map((id) => (
						<DropdownMenuRadioItem key={id} value={id}>
							{id === theme ? <RiCheckLine /> : <span aria-hidden className="size-14 shrink-0" />}
							<span>{t(THEMES[id])}</span>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
