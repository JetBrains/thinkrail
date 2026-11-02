import { RiMagicLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";
import { SettingsNotice } from "@/panels/SettingsNotice";

export default function CustomIcon() {
	const t = useT();
	const [adding, setAdding] = useState(false);
	return (
		<SettingsNotice
			variant="info"
			icon={<RiMagicLine className="size-14" />}
			testId="global-templates-empty"
			action={
				<Button
					variant="outline"
					size="m"
					iconLeft={RiMagicLine}
					disabled={adding}
					onClick={() => {
						setAdding(true);
						setTimeout(() => setAdding(false), 1500);
					}}
				>
					{t("settings.templates.addStarters")}
				</Button>
			}
		>
			<p>{t("settings.templates.globalEmpty")}</p>
			<p className="tr-text-metadata text-text-muted">
				{t("settings.templates.globalEmptyDescription")}
			</p>
		</SettingsNotice>
	);
}
