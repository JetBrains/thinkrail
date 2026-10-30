import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Textarea } from "@thinkrail/ui/textarea";
import { useState } from "react";

export default function Disabled() {
	const t = useT();
	const [body, setBody] = useState("Review the open pull request and list blocking issues.");
	const [saving, setSaving] = useState(false);
	const save = () => {
		setSaving(true);
		setTimeout(() => setSaving(false), 1500);
	};
	return (
		<div className="flex w-full flex-col items-end gap-8">
			<Textarea
				aria-label={t("chat.templateEditor.body")}
				disabled={saving}
				value={body}
				onChange={(event) => setBody(event.target.value)}
				rows={4}
			/>
			<Button loading={saving} onClick={save}>
				{t("common.save")}
			</Button>
		</div>
	);
}
