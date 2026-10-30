import { RiChatNewLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Textarea } from "@thinkrail/ui/textarea";
import { useEffect, useState } from "react";
import { StaleComposerNotice } from "../../../../../packages/resource-renderers/src/renderers/StaleComposerNotice";

export default function FileChanged() {
	const t = useT();
	const [version, setVersion] = useState(1);
	const [composing, setComposing] = useState(false);
	const [stale, setStale] = useState(false);
	useEffect(() => {
		if (!composing) return;
		const timer = window.setTimeout(() => {
			setVersion((value) => value + 1);
			setComposing(false);
			setStale(true);
		}, 2500);
		return () => window.clearTimeout(timer);
	}, [composing]);
	return (
		<div className="flex w-full flex-col gap-8">
			<pre className="tr-code-text text-text-default">{`const retries = ${version};`}</pre>
			<Button
				variant="outline"
				size="s"
				iconLeft={RiChatNewLine}
				className="self-start"
				onClick={() => {
					setStale(false);
					setComposing(true);
				}}
			>
				{t("viewer.code.commentOnLine")}
			</Button>
			<StaleComposerNotice visible={stale} />
			{composing ? <Textarea rows={2} placeholder={t("review.composer.placeholder")} /> : null}
		</div>
	);
}
