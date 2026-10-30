import { RiArrowDownSLine, RiContrastDrop2Line } from "@remixicon/react";
import { Button } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { useLayoutEffect, useState } from "react";
import { applyTheme, getThemes } from "@/themes";

const STORAGE_KEY = "thinkrail-library-theme";

function initialTheme(): string {
	const ids = getThemes().map((theme) => theme.id);
	const requested = new URLSearchParams(window.location.search).get("theme");
	const stored = window.localStorage.getItem(STORAGE_KEY);
	return [requested, stored].find((id): id is string => !!id && ids.includes(id)) ?? "dark";
}

export function ThemeMenu() {
	const themes = getThemes();
	const [theme, setTheme] = useState(initialTheme);
	useLayoutEffect(() => {
		applyTheme(theme);
		window.localStorage.setItem(STORAGE_KEY, theme);
	}, [theme]);
	const current = themes.find((entry) => entry.id === theme);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="outline"
					size="m"
					iconLeft={RiContrastDrop2Line}
					iconRight={RiArrowDownSLine}
					data-testid="library-theme"
					aria-label={`Theme: ${current?.label ?? theme}`}
				>
					{current?.label ?? theme}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuLabel>Theme</DropdownMenuLabel>
				<DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
					{themes.map((entry) => (
						<DropdownMenuRadioItem key={entry.id} value={entry.id} data-theme-id={entry.id}>
							{entry.label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
