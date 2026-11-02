import { useState } from "react";
import { ChangeRowActions } from "@/panels/ChangeRowActions";
import { TreeRow } from "@/panels/TreeRow";

const files = ["src/panels/PlanPane.tsx", "packages/ui/menu-styles.ts"];

export default function RowMenu() {
	const [active, setActive] = useState<string | null>(null);
	return (
		<div className="flex w-full max-w-[20rem] flex-col">
			{files.map((path) => (
				<ChangeRowActions
					key={path}
					path={path}
					active={active === path}
					onView={() => setActive(path)}
					onOpenTab={() => setActive(path)}
				>
					{({ onContextMenu }) => (
						<TreeRow
							testid="change-item"
							kind="file"
							highlight="wrapper"
							active={active === path}
							label={path.split("/").pop() ?? path}
							onClick={() => setActive(path)}
							onContextMenu={onContextMenu}
						/>
					)}
				</ChangeRowActions>
			))}
		</div>
	);
}
