import { useT } from "@thinkrail/locales/react";
import { AttentionLine } from "@thinkrail/ui/attention-line";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";

export default function Awaiting() {
	const t = useT();
	const [canRespond, setCanRespond] = useState(true);
	return (
		<div className="flex flex-col gap-4">
			{canRespond ? <AttentionLine /> : null}
			<div className="flex gap-8">
				<Button
					variant="outline"
					size="m"
					disabled={!canRespond}
					onClick={() => setCanRespond(false)}
				>
					{t("tools.ask.skip")}
				</Button>
				<Button size="m" disabled={!canRespond} onClick={() => setCanRespond(false)}>
					{t("tools.ask.submit")}
				</Button>
				{canRespond ? null : (
					<Button variant="ghost" size="m" onClick={() => setCanRespond(true)}>
						{t("common.retry")}
					</Button>
				)}
			</div>
		</div>
	);
}
