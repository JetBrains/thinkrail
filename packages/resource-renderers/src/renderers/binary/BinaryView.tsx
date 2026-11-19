import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useOptionalResourceHost } from "../../host";
import type { ResourceViewProps } from "../../registry";

function fileName(path: string): string {
	return path.split("/").at(-1) ?? path;
}

function byteSize(t: Translator, bytes: number | undefined): string {
	if (bytes === undefined) return t("viewer.fileInfo.unknownSize");
	return t("viewer.binary.bytes", {
		count: bytes,
		size: bytes.toLocaleString(localeOf(t)),
	});
}

export default function BinaryView({ resource, content }: ResourceViewProps) {
	const t = useT();
	const host = useOptionalResourceHost();
	const bytes = content.kind === "bytes" ? content : null;
	return (
		<div className="flex h-full items-center justify-center bg-container-workspace-bg p-24">
			<section
				data-testid="binary-resource"
				className="w-full max-w-lg rounded-md border border-border-default bg-container-header-bg p-16"
			>
				<h2 className="truncate tr-title-entity text-text-default">{fileName(resource.path)}</h2>
				<dl className="mt-12 grid grid-cols-[auto_1fr] gap-x-12 gap-y-4 tr-text-metadata text-text-muted">
					<dt>{t("viewer.fileInfo.size")}</dt>
					<dd>{byteSize(t, bytes?.byteLength ?? resource.byteLength)}</dd>
					<dt>{t("viewer.fileInfo.hash")}</dt>
					<dd className="truncate tr-code-text">
						{bytes ? bytes.hash.slice(0, 12) : t("viewer.binary.unavailable")}
					</dd>
				</dl>
				{bytes && host ? (
					<div className="mt-16 flex flex-wrap gap-8">
						{host ? (
							<Button
								variant="primary"
								onClick={() => host.openPathExternally(resource.workspaceId, resource.path)}
							>
								{t("viewer.binary.openExternally")}
							</Button>
						) : null}
						{host ? (
							<Button
								variant="outline"
								onClick={() => host.revealInFileManager(resource.workspaceId, resource.path)}
							>
								{t("viewer.binary.revealInFileManager")}
							</Button>
						) : null}
					</div>
				) : null}
			</section>
		</div>
	);
}
