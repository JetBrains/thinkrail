import { CircleAlert, Info, Lightbulb, OctagonAlert, TriangleAlert } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import type { Components } from "react-markdown";

/**
 * GitHub-style alert callouts (`> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]`)
 * for the rendered markdown view. Two pieces, wired only into `MarkdownPreview` (not chat):
 *  - `remarkGithubAlerts` — a tiny in-repo remark transform (no extra dep): re-tags a matching
 *    blockquote as a custom `mdalert` element carrying its variant, and strips the marker text.
 *  - `AlertCallout` — the React renderer (mapped via react-markdown `components`), a lucide icon + label
 *    over the body, colored with our theme tokens.
 */

export type AlertVariant = "note" | "tip" | "important" | "warning" | "caution";

const MARKER = /^\[!(note|tip|important|warning|caution)\]/i;

/** Pure marker parse (unit-tested): reads the leading `[!VARIANT]` and returns the remaining body text. */
export function parseAlertMarker(text: string): { variant: AlertVariant; rest: string } | null {
	const m = MARKER.exec(text);
	const marker = m?.[0];
	const variant = m?.[1];
	if (!marker || !variant) return null;
	// Drop the marker, then any trailing spaces + a single newline (the marker sits on its own line).
	const rest = text.slice(marker.length).replace(/^[^\S\n]*\n?/, "");
	return { variant: variant.toLowerCase() as AlertVariant, rest };
}

// Minimal structural mdast shapes — only the fields this transform reads/writes (no @types/mdast dep).
interface MdNode {
	type: string;
	value?: string;
	children?: MdNode[];
	data?: { hName?: string; hProperties?: Record<string, unknown> };
}

/** Remark plugin: turn GitHub-alert blockquotes into `mdalert` elements tagged with their variant. */
export function remarkGithubAlerts() {
	return (tree: MdNode): void => walk(tree);
}

function walk(node: MdNode): void {
	if (!node.children) return;
	for (const child of node.children) {
		if (child.type === "blockquote") transformBlockquote(child);
		walk(child);
	}
}

function transformBlockquote(bq: MdNode): void {
	const firstPara = bq.children?.[0];
	if (firstPara?.type !== "paragraph") return;
	const firstText = firstPara.children?.[0];
	if (firstText?.type !== "text" || typeof firstText.value !== "string") return;
	const parsed = parseAlertMarker(firstText.value);
	if (!parsed) return;
	firstText.value = parsed.rest;
	// If stripping the marker emptied the first paragraph (marker on its own line), drop it.
	if (parsed.rest === "" && firstPara.children?.length === 1) bq.children?.shift();
	bq.data = {
		...bq.data,
		hName: "mdalert",
		hProperties: { ...bq.data?.hProperties, variant: parsed.variant },
	};
}

const ALERTS: Record<
	AlertVariant,
	{
		label: string;
		icon: ComponentType<{ className?: string }>;
		border: string;
		bg: string;
		text: string;
	}
> = {
	note: { label: "Note", icon: Info, border: "border-blue", bg: "bg-blue/10", text: "text-blue" },
	tip: {
		label: "Tip",
		icon: Lightbulb,
		border: "border-green",
		bg: "bg-green/10",
		text: "text-green",
	},
	important: {
		label: "Important",
		icon: CircleAlert,
		border: "border-primary",
		bg: "bg-primary/10",
		text: "text-primary",
	},
	warning: {
		label: "Warning",
		icon: TriangleAlert,
		border: "border-gold",
		bg: "bg-gold/10",
		text: "text-gold",
	},
	caution: {
		label: "Caution",
		icon: OctagonAlert,
		border: "border-red",
		bg: "bg-red/10",
		text: "text-red",
	},
};

function isVariant(v: unknown): v is AlertVariant {
	return v === "note" || v === "tip" || v === "important" || v === "warning" || v === "caution";
}

/** Renderer for the `mdalert` element the remark transform emits (the variant rides on hProperties). */
function AlertCallout({
	node,
	children,
}: {
	node?: { properties?: Record<string, unknown> };
	children?: ReactNode;
}) {
	const raw = node?.properties?.variant;
	const cfg = ALERTS[isVariant(raw) ? raw : "note"];
	const Icon = cfg.icon;
	return (
		<div
			data-testid="md-alert"
			data-variant={isVariant(raw) ? raw : "note"}
			className={`my-md rounded-r-[var(--radius-sm)] border-l-2 py-sm pr-md pl-md text-text ${cfg.border} ${cfg.bg} [&>*:last-child]:mb-0 [&_p]:my-1`}
		>
			<p className={`mb-xs flex items-center gap-xs font-semibold ${cfg.text}`}>
				<Icon className="size-4 shrink-0" />
				{cfg.label}
			</p>
			{children}
		</div>
	);
}

/** Component map to hand react-markdown so `mdalert` elements render as callouts. */
export const alertComponents = { mdalert: AlertCallout } as Components;
