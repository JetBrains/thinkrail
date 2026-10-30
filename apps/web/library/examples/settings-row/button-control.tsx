import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";
import { ConfirmDialog } from "@/panels/ConfirmDialog";
import { SettingsRow } from "@/panels/SettingsRow";

export default function ButtonControl() {
	const t = useT();
	const [confirming, setConfirming] = useState(false);
	return (
		<div className="w-full max-w-[32rem]">
			<SettingsRow
				label={t("workbench.layoutSettings.resetToDefault")}
				description={t("workbench.layoutSettings.resetDescription", {
					name: t("workbench.preset.balanced"),
				})}
				control={
					<Button variant="outline" size="m" onClick={() => setConfirming(true)}>
						{t("workbench.layoutSettings.reset")}
					</Button>
				}
			/>
			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title={t("workbench.layoutSettings.applyTitle")}
				description={t("workbench.layoutSettings.applyDescription")}
				confirmLabel={t("workbench.layoutSettings.applyConfirm")}
				onConfirm={() => setConfirming(false)}
			/>
		</div>
	);
}
