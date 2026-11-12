import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type { ResourceContent, ResourceDiffProps } from "../../registry";

function sideSize(t: Translator, content: ResourceContent): string {
	if (content.kind === "absent") return t("viewer.binary.absent");
	const bytes =
		content.kind === "bytes"
			? content.byteLength
			: new TextEncoder().encode(content.text).byteLength;
	return t("viewer.binary.bytes", {
		count: bytes,
		size: bytes.toLocaleString(localeOf(t)),
	});
}

export default function BinaryDiff({ original, modified }: ResourceDiffProps) {
	const t = useT();
	return (
		<div className="flex h-full items-center justify-center bg-container-content-bg p-24">
			<section
				data-testid="binary-diff"
				className="w-full max-w-lg rounded-md border border-border-default bg-container-header-bg p-16 text-center"
			>
				<h2 className="tr-title-entity text-text-default">{t("viewer.binary.differ")}</h2>
				<div className="mt-12 flex items-center justify-center gap-24 tr-text-metadata text-text-muted">
					<span>{t("viewer.binary.original", { size: sideSize(t, original) })}</span>
					<span>{t("viewer.binary.modified", { size: sideSize(t, modified) })}</span>
				</div>
			</section>
		</div>
	);
}
