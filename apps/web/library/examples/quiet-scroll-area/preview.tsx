import { useState } from "react";
import { QuietScrollArea } from "@/components/QuietScrollArea";
import { TreeRow } from "@/panels/TreeRow";

const FILES = Array.from({ length: 24 }, (_, index) => `component-${index + 1}.tsx`);

export default function Preview() {
	const [active, setActive] = useState(FILES[0]);
	return (
		<div className="h-160 w-full max-w-[20rem] bg-container-sidebar-bg">
			<QuietScrollArea className="h-full" viewportClassName="p-panel-inset">
				<ul className="flex flex-col">
					{FILES.map((name) => (
						<li key={name}>
							<TreeRow
								testid="file-node"
								kind="file"
								active={active === name}
								label={name}
								onClick={() => setActive(name)}
							/>
						</li>
					))}
				</ul>
			</QuietScrollArea>
		</div>
	);
}
