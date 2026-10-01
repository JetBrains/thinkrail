import { formatLfsSize, type LfsPointer } from "./lfsPointer";

export function LfsCard({
	label,
	pointer,
	testid,
}: {
	label?: string;
	pointer: LfsPointer | null;
	testid: string;
}) {
	return (
		<section
			data-testid={testid}
			className="w-full max-w-lg rounded-[var(--radius-md)] border border-border-default bg-container-header-bg p-16"
		>
			{label ? <span className="tr-text-metadata text-text-muted">{label}</span> : null}
			<h2 className="tr-title-entity text-text-default">Stored in Git LFS</h2>
			<p className="mt-4 tr-text-metadata text-text-muted">
				This checkout holds the pointer, not the content. Run <code>git lfs pull</code> to fetch it.
			</p>
			<dl className="mt-12 grid grid-cols-[auto_1fr] gap-x-12 gap-y-4 tr-text-metadata text-text-muted">
				<dt>Size</dt>
				<dd data-testid={`${testid}-size`}>
					{pointer ? formatLfsSize(pointer.size) : "Unreadable pointer"}
				</dd>
				<dt>Object</dt>
				<dd className="truncate tr-code-text" title={pointer?.oid}>
					{pointer ? pointer.oid.slice(0, 12) : "—"}
				</dd>
			</dl>
		</section>
	);
}
