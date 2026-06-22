import { PRODUCT_NAME } from "../constants/branding";
import { ProjectTree } from "../panels/ProjectTree";
import { useAppStore } from "../store/appStore";
import type { ConnectionStatus } from "../transport";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
	connected: "Connected",
	connecting: "Connecting…",
	disconnected: "Disconnected",
};

const STATUS_DOT: Record<ConnectionStatus, string> = {
	connected: "bg-green",
	connecting: "bg-gold",
	disconnected: "bg-red",
};

export function Shell() {
	const status = useAppStore((s) => s.status);
	return (
		<div data-testid="shell" className="grid h-full grid-rows-[auto_1fr]">
			<header className="flex items-center justify-between border-b border-border2 bg-bg-dark px-lg py-sm">
				<span className="font-[var(--font-accent)] text-lg font-extrabold tracking-[0.5px] text-primary">
					{PRODUCT_NAME}
				</span>
				<span
					data-testid="connection-status"
					data-status={status}
					className="inline-flex items-center gap-sm text-sm text-muted"
				>
					<span className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
					{STATUS_LABEL[status]}
				</span>
			</header>
			<div className="grid min-h-0 grid-cols-[240px_1fr_320px]">
				<aside data-testid="left-nav" className="overflow-auto border-r border-border p-md">
					<ProjectTree />
				</aside>
				<main data-testid="center-tabs" className="flex items-center justify-center text-hint">
					Open a file or start a chat
				</main>
				<aside data-testid="right-panel" className="overflow-auto border-l border-border p-md">
					<div className="text-xs uppercase tracking-wider text-muted">All files · Changes</div>
				</aside>
			</div>
		</div>
	);
}
