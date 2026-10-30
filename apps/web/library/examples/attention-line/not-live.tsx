import { useT } from "@thinkrail/locales/react";
import { AttentionLine } from "@thinkrail/ui/attention-line";
import { useEffect, useState } from "react";

export default function NotLive() {
	const t = useT();
	const [announcement, setAnnouncement] = useState("");
	useEffect(() => {
		const frame = requestAnimationFrame(() =>
			setAnnouncement(t("chat.transcript.inputNeeded", { title: "Deploy to staging?" })),
		);
		return () => cancelAnimationFrame(frame);
	}, [t]);
	return (
		<div className="flex flex-col gap-4">
			<span role="status" aria-live="polite" className="sr-only">
				{announcement}
			</span>
			<AttentionLine live={false} />
		</div>
	);
}
