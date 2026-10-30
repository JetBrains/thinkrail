import { AttentionLine } from "@thinkrail/ui/attention-line";
import { useEffect, useState } from "react";

export default function Announced() {
	const [announced, setAnnounced] = useState(false);
	useEffect(() => {
		const frame = requestAnimationFrame(() => setAnnounced(true));
		return () => cancelAnimationFrame(frame);
	}, []);
	return <AttentionLine announced={announced} />;
}
