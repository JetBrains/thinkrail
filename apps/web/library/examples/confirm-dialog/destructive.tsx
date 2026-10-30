import { RiCloseLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { useRef, useState } from "react";
import { ConfirmDialog } from "@/panels/ConfirmDialog";

export default function Destructive() {
	const t = useT();
	const opener = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	return (
		<>
			<IconButton
				ref={opener}
				icon={RiCloseLine}
				label={t("common.close")}
				onClick={() => setOpen(true)}
			/>
			<ConfirmDialog
				open={open}
				onOpenChange={setOpen}
				title={t("panels.terminalWorkbench.busyTitle")}
				description={t("panels.terminalWorkbench.busyDescription", { title: "bun run dev" })}
				confirmLabel={t("panels.terminalWorkbench.closeAnyway")}
				destructive
				onConfirm={() => {}}
				onClosedAutoFocus={() => opener.current?.focus()}
			/>
		</>
	);
}
