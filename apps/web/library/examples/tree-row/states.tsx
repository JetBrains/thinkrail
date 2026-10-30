import { TreeRow } from "@/panels/TreeRow";

export default function States() {
	return (
		<ul className="flex w-full max-w-[16rem] flex-col">
			<li>
				<TreeRow testid="file-node" kind="dir" label="collapsed" />
			</li>
			<li>
				<TreeRow testid="file-node" kind="dir" expanded label="expanded" />
			</li>
			<li>
				<TreeRow testid="file-node" kind="file" label="file.ts" />
			</li>
			<li>
				<TreeRow testid="file-node" kind="file" active label="active.ts" />
			</li>
			<li>
				<TreeRow testid="file-node" kind="dir" subtle dataStatus="ignored" label="node_modules" />
			</li>
		</ul>
	);
}
