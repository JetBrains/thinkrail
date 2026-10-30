import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";

export default function Variants() {
	const t = useT();
	return (
		<div className="flex flex-wrap items-center gap-8">
			<Button variant="primary">{t("common.save")}</Button>
			<Button variant="soft-primary">{t("common.confirm")}</Button>
			<Button variant="outline">{t("common.cancel")}</Button>
			<Button variant="ghost">{t("common.dismiss")}</Button>
			<Button variant="destructive">{t("common.delete")}</Button>
		</div>
	);
}
