import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useRef, useState } from "react";
import { ConfirmDialog } from "@/panels/ConfirmDialog";

export default function Preview() {
	const t = useT();
	const opener = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button ref={opener} variant="outline" onClick={() => setOpen(true)}>
				{t("panels.projectTree.closeProject")}
			</Button>
			<ConfirmDialog
				open={open}
				onOpenChange={setOpen}
				title={t("panels.projectTree.closeTitle", { name: "thinkrail" })}
				description={t("panels.projectTree.closeDescription")}
				confirmLabel={t("panels.projectTree.closeProject")}
				onConfirm={() => {}}
				onClosedAutoFocus={() => opener.current?.focus()}
			/>
		</>
	);
}
