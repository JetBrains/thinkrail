import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { LspServerRow } from "./LspServerList";
import type { WorkspaceLsps } from "./useWorkspaceLsps";

/**
 * "Language servers" in the workspace status drawer, beside MCP servers and subagents. Renders
 * nothing where the host has no LSP manager, so a browser session shows no empty section.
 */
export function LspResourcesSection({
	lsps,
	onOpenSettings,
}: {
	lsps: WorkspaceLsps;
	onOpenSettings: () => void;
}) {
	const t = useT();
	if (lsps.state === "unsupported" || lsps.state === "idle") return null;
	const servers = lsps.state === "ready" ? lsps.servers : [];
	return (
		<section
			data-testid="resources-lsp"
			aria-label={t("resources.lsp.title")}
			className="flex flex-col gap-2"
		>
			<div className="flex items-baseline gap-4 px-8 pt-8 pb-2 text-text-subtle">
				<h3 className="tr-text-eyebrow">{t("resources.lsp.title")}</h3>
				{lsps.state === "ready" ? (
					<span className="tr-text-metadata">· {servers.length}</span>
				) : null}
				<span className="flex-1" />
				<Button
					variant="soft-primary"
					size="s"
					data-testid="resources-lsp-settings"
					onClick={onOpenSettings}
				>
					{t("resources.lsp.settings")}
				</Button>
			</div>
			{lsps.state === "failed" ? (
				<p className="px-8 py-4 text-text-subtle tr-text-metadata">{t("settings.lsp.failed")}</p>
			) : servers.length === 0 ? (
				<p className="px-8 py-4 text-text-subtle tr-text-metadata">
					{lsps.state === "loading" ? t("resources.lsp.loading") : t("resources.lsp.empty")}
				</p>
			) : (
				<ul className="flex flex-col">
					{servers.map((server) => (
						<LspServerRow key={server.id} server={server} compact />
					))}
				</ul>
			)}
		</section>
	);
}
