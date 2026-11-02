import { useState } from "react";
import { TreeRow } from "@/panels/TreeRow";

const files = ["Button.tsx", "Dialog.tsx", "index.ts"];

export default function Preview() {
	const [expanded, setExpanded] = useState(true);
	const [active, setActive] = useState("Button.tsx");
	return (
		<ul className="flex w-full max-w-[16rem] flex-col">
			<li>
				<TreeRow
					testid="file-node"
					kind="dir"
					expanded={expanded}
					label="components"
					onClick={() => setExpanded((open) => !open)}
				/>
				{expanded && (
					<ul className="flex flex-col pl-tree-indent">
						{files.map((name) => (
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
				)}
			</li>
		</ul>
	);
}
