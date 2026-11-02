import { RiAddLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";
import { QuietScrollArea } from "@/components/QuietScrollArea";
import { TreeRow } from "@/panels/TreeRow";

export default function GrowingContent() {
	const t = useT();
	const [count, setCount] = useState(3);
	const names = Array.from({ length: count }, (_, index) => `workspace-${index + 1}`);
	return (
		<div className="flex w-full flex-col gap-8">
			<Button
				variant="outline"
				size="m"
				className="self-start"
				iconLeft={RiAddLine}
				onClick={() => setCount((value) => value + 1)}
			>
				{t("common.add")}
			</Button>
			<div className="h-160 w-full max-w-[20rem] bg-container-sidebar-bg">
				<QuietScrollArea className="h-full" viewportClassName="p-panel-inset">
					<ul className="flex flex-col">
						{names.map((name) => (
							<li key={name}>
								<TreeRow testid="workspace-node" kind="dir" label={name} onClick={() => {}} />
							</li>
						))}
					</ul>
				</QuietScrollArea>
			</div>
		</div>
	);
}
