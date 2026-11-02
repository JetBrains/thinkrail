import { T, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useRef, useState } from "react";
import { ConfirmDialog } from "@/panels/ConfirmDialog";

export default function RichDescription() {
	const t = useT();
	const opener = useRef<HTMLButtonElement>(null);
	const [path, setPath] = useState<string | null>(null);
	return (
		<>
			<Button ref={opener} variant="outline" onClick={() => setPath("~/notes")}>
				{t("panels.openProjectPath.submit")}
			</Button>
			<ConfirmDialog
				open={path !== null}
				onOpenChange={(open) => {
					if (!open) setPath(null);
				}}
				title={t("panels.openProject.initTitle")}
				description={
					<T
						i18nKey="panels.openProject.initDescription"
						values={{ path }}
						components={[<span key="path" className="tr-text-emphasis text-text-default" />]}
					/>
				}
				confirmLabel={t("panels.openProject.initConfirm")}
				onConfirm={() => {}}
				onClosedAutoFocus={() => opener.current?.focus()}
			/>
		</>
	);
}
