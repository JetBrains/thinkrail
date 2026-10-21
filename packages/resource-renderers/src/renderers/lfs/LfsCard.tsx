import { T, useT } from "@thinkrail/locales/react";
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
	const t = useT();
	return (
		<section
			data-testid={testid}
			className="w-full max-w-lg rounded-md border border-border-default bg-container-header-bg p-16"
		>
			{label ? <span className="tr-text-metadata text-text-muted">{label}</span> : null}
			<h2 className="tr-title-entity text-text-default">{t("viewer.lfs.title")}</h2>
			<p className="mt-4 tr-text-metadata text-text-muted">
				<T i18nKey="viewer.lfs.pullHint" components={[<code key="c" className="tr-code-text" />]} />
			</p>
			<dl className="mt-12 grid grid-cols-[auto_1fr] gap-x-12 gap-y-4 tr-text-metadata text-text-muted">
				<dt>{t("viewer.fileInfo.size")}</dt>
				<dd data-testid={`${testid}-size`}>
					{pointer ? formatLfsSize(pointer.size) : t("viewer.lfs.unreadablePointer")}
				</dd>
				<dt>{t("viewer.fileInfo.object")}</dt>
				<dd className="truncate tr-code-text" title={pointer?.oid}>
					{pointer ? pointer.oid.slice(0, 12) : "—"}
				</dd>
			</dl>
		</section>
	);
}
