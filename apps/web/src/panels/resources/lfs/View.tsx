import type { ResourceViewProps } from "@/resources";
import { LfsCard } from "./LfsCard";
import { parseLfsPointer } from "./lfsPointer";

export default function LfsView({ content }: ResourceViewProps) {
	const pointer = content.kind === "text" ? parseLfsPointer(content.text) : null;
	return (
		<div className="flex h-full items-center justify-center bg-container-workspace-bg p-24">
			<LfsCard pointer={pointer} testid="lfs-pointer" />
		</div>
	);
}
