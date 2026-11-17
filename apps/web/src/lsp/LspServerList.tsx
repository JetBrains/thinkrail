import type { DetectedLspServer, LspServerStatus } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";

const STATUS_LABEL: Readonly<Record<LspServerStatus, MessageKey>> = {
	detected: "settings.lsp.status.detected",
	starting: "settings.lsp.status.starting",
	ready: "settings.lsp.status.ready",
	error: "settings.lsp.status.error",
	missing: "settings.lsp.status.missing",
};

/** `ready` is the Helios accent (the neon halo is `[data-lsp-ready]` in styles/neon.css); only
 * `starting` moves, and not under reduced motion. */
const STATUS_DOT: Readonly<Record<LspServerStatus, string>> = {
	detected: "bg-text-subtle",
	starting: "bg-primary/60 motion-safe:animate-working",
	ready: "bg-primary",
	error: "bg-feedback-error",
	missing: "bg-feedback-warning",
};

export function LspStatusDot({ status }: { status: LspServerStatus }) {
	return (
		<span
			aria-hidden
			data-lsp-ready={status === "ready" ? "" : undefined}
			className={cn("size-6 shrink-0 rounded-full", STATUS_DOT[status])}
		/>
	);
}

export function lspStatusLabelKey(status: LspServerStatus): MessageKey {
	return STATUS_LABEL[status];
}

export function LspServerRow({
	server,
	compact = false,
	onRestart,
}: {
	server: DetectedLspServer;
	compact?: boolean;
	onRestart?: ((serverId: string) => void) | undefined;
}) {
	const t = useT();
	const status = t(STATUS_LABEL[server.status]);
	return (
		<li
			data-testid={`lsp-server-${server.id}`}
			data-status={server.status}
			aria-label={t("resources.lsp.rowLabel", { language: server.language, status })}
			className={cn("flex min-w-0 flex-col gap-2", compact ? "px-8 py-4" : "px-12 py-8")}
		>
			<div className="flex min-w-0 items-center gap-8">
				<LspStatusDot status={server.status} />
				<span className="min-w-0 flex-1 truncate tr-title-compact text-text-default">
					{server.language}
				</span>
				<span
					data-testid={`lsp-status-${server.id}`}
					className="whitespace-nowrap text-text-muted tr-text-metadata"
				>
					{status}
				</span>
				{onRestart && server.status !== "missing" ? (
					<Button
						variant="outline"
						size="s"
						data-testid={`lsp-restart-${server.id}`}
						onClick={() => onRestart(server.id)}
					>
						{t("settings.lsp.restart")}
					</Button>
				) : null}
			</div>
			{server.binaryPath ? (
				<code
					data-testid={`lsp-binary-${server.id}`}
					className="min-w-0 wrap-anywhere pl-14 text-text-muted tr-text-metadata"
				>
					{server.binaryPath}
				</code>
			) : null}
			{server.installHint ? (
				<span
					data-testid={`lsp-hint-${server.id}`}
					className="min-w-0 wrap-anywhere pl-14 text-text-muted tr-text-metadata"
				>
					{t("settings.lsp.installHint", { marker: server.marker, hint: server.installHint })}
				</span>
			) : null}
		</li>
	);
}
