import { RiUploadCloud2Line } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useRef, useState } from "react";
import { ConfirmDialog } from "@/panels/ConfirmDialog";

export default function Push() {
	const t = useT();
	const opener = useRef<HTMLButtonElement>(null);
	const [branch, setBranch] = useState<string | null>(null);
	const ahead = 2;
	return (
		<>
			<Button
				ref={opener}
				variant="outline"
				size="m"
				iconLeft={RiUploadCloud2Line}
				onClick={() => setBranch("main")}
			>
				{t("panels.ship.confirmPush.confirm", { branch: "main" })}
			</Button>
			<ConfirmDialog
				open={branch !== null}
				onOpenChange={(open) => {
					if (!open) setBranch(null);
				}}
				title={t("panels.ship.confirmPush.title", { branch })}
				description={t("panels.ship.confirmPush.descriptionCommits", { count: ahead, branch })}
				confirmLabel={t("panels.ship.confirmPush.confirm", { branch })}
				confirmTestId="ship-confirm-base-push"
				onConfirm={() => {}}
				onClosedAutoFocus={() => opener.current?.focus()}
			/>
		</>
	);
}
