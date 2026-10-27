import { RiSave3Line } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";

export default function Loading() {
	const t = useT();
	const [saving, setSaving] = useState(false);
	const [saves, setSaves] = useState(0);
	const save = () => {
		setSaving(true);
		setSaves((count) => count + 1);
		setTimeout(() => setSaving(false), 1500);
	};
	return (
		<div className="flex flex-wrap items-center gap-8">
			<Button iconLeft={RiSave3Line} loading={saving} onClick={save}>
				{t("common.save")}
			</Button>
			<Button variant="outline" loading={saving} onClick={save}>
				{t("common.save")}
			</Button>
			<output className="tr-text-metadata text-text-muted">{saves}</output>
		</div>
	);
}
