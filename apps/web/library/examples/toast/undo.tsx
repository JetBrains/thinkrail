import { RiArrowGoBackLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useAppStore } from "@/store";

export default function Undo() {
	const t = useT();
	const pushToast = useAppStore((s) => s.pushToast);
	return (
		<Button
			variant="outline"
			size="m"
			iconLeft={RiArrowGoBackLine}
			onClick={() =>
				pushToast({
					variant: "success",
					message: t("panels.diffSurface.revertedFile", { file: "src/app.ts" }),
					durationMs: 8000,
					action: { label: t("panels.diffSurface.undo"), onClick: () => {} },
				})
			}
		>
			{t("panels.diffPane.revertFile")}
		</Button>
	);
}
