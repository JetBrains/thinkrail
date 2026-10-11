import type { ResourceContent, ResourceDiffProps } from "@/resources";

function sideSize(content: ResourceContent): string {
	if (content.kind === "absent") return "Absent";
	if (content.kind === "bytes") return `${content.byteLength.toLocaleString()} bytes`;
	return `${new TextEncoder().encode(content.text).byteLength.toLocaleString()} bytes`;
}

export default function BinaryDiff({ original, modified }: ResourceDiffProps) {
	return (
		<div className="flex h-full items-center justify-center bg-container-content-bg p-24">
			<section
				data-testid="binary-diff"
				className="w-full max-w-lg rounded-md border border-border-default bg-container-header-bg p-16 text-center"
			>
				<h2 className="tr-title-entity text-text-default">Binary files differ</h2>
				<div className="mt-12 flex items-center justify-center gap-24 tr-text-metadata text-text-muted">
					<span>Original: {sideSize(original)}</span>
					<span>Modified: {sideSize(modified)}</span>
				</div>
			</section>
		</div>
	);
}
