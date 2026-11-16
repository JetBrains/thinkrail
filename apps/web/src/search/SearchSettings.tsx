import { useT } from "@thinkrail/locales/react";
import { Switch } from "@thinkrail/ui/switch";
import { type ReactNode, useState } from "react";
import { keybindingLabel } from "../keybindings";
import { useAppStore } from "../store";

export function SearchSettings({ shortcuts }: { shortcuts?: ReactNode }) {
	const t = useT();
	const doubleShift = useAppStore((state) => state.doubleShiftSearch);
	const [openShortcut] = useState(() => keybindingLabel("search.open"));
	return (
		<section data-testid="settings-keyboard" className="flex flex-col gap-16">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">{t("settings.keyboard.title")}</h3>
				<p className="tr-text-metadata text-text-muted">
					{t("settings.keyboard.intro", { shortcut: openShortcut })}
				</p>
			</div>
			<div className="flex items-start justify-between gap-16">
				<div className="flex flex-col gap-4">
					<span className="tr-text-ui text-text-default">{t("settings.keyboard.doubleShift")}</span>
					<span className="tr-text-metadata text-text-muted">
						{t("settings.keyboard.doubleShiftHint")}
					</span>
				</div>
				<Switch
					checked={doubleShift}
					label={t("settings.keyboard.doubleShift")}
					testId="settings-double-shift"
					onCheckedChange={(checked) => useAppStore.getState().setDoubleShiftSearch(checked)}
				/>
			</div>
			{shortcuts ? (
				<div className="flex flex-col gap-8">
					<h4 className="tr-title-compact text-text-default">{t("settings.keyboard.shortcuts")}</h4>
					{shortcuts}
				</div>
			) : null}
		</section>
	);
}
