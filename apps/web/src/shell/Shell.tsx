import type { CSSProperties } from "react";
import { PRODUCT_NAME } from "../constants/branding";
import { useAppStore } from "../store/appStore";
import type { ConnectionStatus } from "../transport";

const styles: Record<string, CSSProperties> = {
	shell: { display: "grid", gridTemplateRows: "auto 1fr", height: "100%" },
	topbar: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		padding: "var(--space-sm) var(--space-lg)",
		borderBottom: "1px solid var(--border2)",
		background: "var(--bg-dark)",
	},
	wordmark: {
		fontFamily: "var(--font-accent)",
		fontWeight: 800,
		fontSize: "var(--font-lg)",
		color: "var(--primary)",
		letterSpacing: "0.5px",
	},
	status: {
		display: "inline-flex",
		alignItems: "center",
		gap: "var(--space-sm)",
		color: "var(--muted)",
		fontSize: "var(--font-sm)",
	},
	dot: { width: 8, height: 8, borderRadius: "50%" },
	body: { display: "grid", gridTemplateColumns: "240px 1fr 320px", minHeight: 0 },
	left: { borderRight: "1px solid var(--border)", padding: "var(--space-md)", overflow: "auto" },
	center: { display: "flex", alignItems: "center", justifyContent: "center", color: "var(--hint)" },
	right: { borderLeft: "1px solid var(--border)", padding: "var(--space-md)", overflow: "auto" },
	colLabel: {
		textTransform: "uppercase",
		fontSize: "var(--font-xs)",
		letterSpacing: "var(--uppercase-spacing)",
		color: "var(--muted)",
	},
};

const STATUS_LABEL: Record<ConnectionStatus, string> = {
	connected: "Connected",
	connecting: "Connecting…",
	disconnected: "Disconnected",
};
const STATUS_COLOR: Record<ConnectionStatus, string> = {
	connected: "var(--green)",
	connecting: "var(--gold)",
	disconnected: "var(--red)",
};

export function Shell() {
	const status = useAppStore((s) => s.status);
	return (
		<div data-testid="shell" style={styles.shell}>
			<header style={styles.topbar}>
				<span style={styles.wordmark}>{PRODUCT_NAME}</span>
				<span data-testid="connection-status" data-status={status} style={styles.status}>
					<span style={{ ...styles.dot, background: STATUS_COLOR[status] }} />
					{STATUS_LABEL[status]}
				</span>
			</header>
			<div style={styles.body}>
				<aside data-testid="left-nav" style={styles.left}>
					<div style={styles.colLabel}>Projects</div>
				</aside>
				<main data-testid="center-tabs" style={styles.center}>
					Open a file or start a chat
				</main>
				<aside data-testid="right-panel" style={styles.right}>
					<div style={styles.colLabel}>All files · Changes</div>
				</aside>
			</div>
		</div>
	);
}
