import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";

export default function DialogActions() {
	const t = useT();
	return (
		<div className="flex justify-end gap-8">
			<Button variant="outline" onClick={() => {}}>
				{t("common.cancel")}
			</Button>
			<Button onClick={() => {}}>{t("common.save")}</Button>
		</div>
	);
}
