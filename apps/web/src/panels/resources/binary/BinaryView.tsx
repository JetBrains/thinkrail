import type { ResourceViewProps } from "@/resources";

function fileName(path: string): string {
	return path.split("/").at(-1) ?? path;
}

function byteSize(bytes: number | undefined): string {
	if (bytes === undefined) return "Unknown size";
	return `${bytes.toLocaleString()} bytes`;
}

export default function BinaryView({ resource, content }: ResourceViewProps) {
	const bytes = content.kind === "bytes" ? content : null;
	return (
		<div className="flex h-full items-center justify-center bg-container-workspace-bg p-24">
			<section
				data-testid="binary-resource"
				className="w-full max-w-lg rounded-md border border-border-default bg-container-header-bg p-16"
			>
				<h2 className="truncate tr-title-entity text-text-default">{fileName(resource.path)}</h2>
				<dl className="mt-12 grid grid-cols-[auto_1fr] gap-x-12 gap-y-4 tr-text-metadata text-text-muted">
					<dt>Size</dt>
					<dd>{byteSize(bytes?.byteLength ?? resource.byteLength)}</dd>
					<dt>Hash</dt>
					<dd className="truncate tr-code-text">
						{bytes ? bytes.hash.slice(0, 12) : "Unavailable"}
					</dd>
				</dl>
				{bytes ? (
					<a
						href={bytes.url}
						download={fileName(resource.path)}
						className="mt-16 inline-flex rounded-sm bg-control-primary-bg px-12 py-4 tr-text-action text-control-primary-text hover:bg-control-primary-bg-hovered"
					>
						Open externally
					</a>
				) : null}
			</section>
		</div>
	);
}
