import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { LspServerRow } from "./LspServerList";
import { getNativeLspBridge } from "./nativeLsp";
import { useWorkspaceLsps } from "./useWorkspaceLsps";

/** Settings → Extensions → Languages & LSP: the active workspace's detected language servers. */
export function LspSettings({
	worktreePath,
	onEditFailed,
}: {
	worktreePath: string | undefined;
	onEditFailed: () => void;
}) {
	const t = useT();
	const { lsps, refresh, restart } = useWorkspaceLsps(worktreePath);
	if (lsps.state === "unsupported") {
		return (
			<section data-testid="settings-lsp" className="flex flex-col">
				<LspHeading />
				<p
					data-testid="lsp-unsupported"
					className="rounded-sm border border-border-default bg-container-elevated-bg px-12 py-8 text-text-muted tr-text-metadata"
				>
					{t("settings.lsp.unsupported")}
				</p>
			</section>
		);
	}
	return (
		<section data-testid="settings-lsp" className="flex flex-col gap-8">
			<LspHeading />
			<div className="flex flex-wrap items-center gap-8">
				<Button variant="outline" size="m" data-testid="lsp-refresh" onClick={refresh}>
					{t("settings.lsp.refresh")}
				</Button>
				<Button
					variant="outline"
					size="m"
					data-testid="lsp-edit-config"
					onClick={() => {
						getNativeLspBridge()
							?.openUserConfig()
							.catch(() => onEditFailed());
					}}
				>
					{t("settings.lsp.editConfig")}
				</Button>
			</div>
			{lsps.state === "loading" ? <LoadingRegion rows={2} className="py-8" /> : null}
			{lsps.state === "idle" ? (
				<LspNote testId="lsp-no-workspace" text={t("settings.lsp.noWorkspace")} />
			) : null}
			{lsps.state === "failed" ? (
				<LspNote testId="lsp-failed" text={t("settings.lsp.failed")} />
			) : null}
			{lsps.state === "ready" && lsps.servers.length === 0 ? (
				<LspNote testId="lsp-empty" text={t("settings.lsp.empty")} />
			) : null}
			{lsps.state === "ready" && lsps.servers.length > 0 ? (
				<ul className="flex flex-col divide-y divide-border-default rounded-sm border border-border-default bg-control-bg">
					{lsps.servers.map((server) => (
						<LspServerRow key={server.id} server={server} onRestart={(id) => restart(id)} />
					))}
				</ul>
			) : null}
		</section>
	);
}

function LspHeading() {
	const t = useT();
	return (
		<div className="flex flex-col gap-4 pb-8">
			<h4 className="tr-text-label-pill text-text-subtle">{t("settings.lsp.title")}</h4>
			<p className="text-text-muted tr-text-metadata">{t("settings.lsp.description")}</p>
		</div>
	);
}

function LspNote({ testId, text }: { testId: string; text: string }) {
	return (
		<p
			data-testid={testId}
			className="rounded-sm border border-border-default bg-container-elevated-bg px-12 py-8 text-text-muted tr-text-metadata"
		>
			{text}
		</p>
	);
}
