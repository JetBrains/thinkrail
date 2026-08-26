import { CircleAlert, Info, Lightbulb, OctagonAlert, TriangleAlert } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import type { Components } from "react-markdown";

export type AlertVariant = "note" | "tip" | "important" | "warning" | "caution";

const MARKER = /^\[!(note|tip|important|warning|caution)\]/i;

export function parseAlertMarker(text: string): { variant: AlertVariant; rest: string } | null {
	const m = MARKER.exec(text);
	const marker = m?.[0];
	const variant = m?.[1];
	if (!marker || !variant) return null;
	const rest = text.slice(marker.length).replace(/^[^\S\n]*\n?/, "");
	return { variant: variant.toLowerCase() as AlertVariant, rest };
}

interface MdNode {
	type: string;
	value?: string;
	children?: MdNode[];
	data?: { hName?: string; hProperties?: Record<string, unknown> };
}

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
	note: {
		label: "Note",
		icon: Info,
		border: "border-feedback-info",
		bg: "bg-feedback-info-subtle",
		text: "text-feedback-info",
	},
	tip: {
		label: "Tip",
		icon: Lightbulb,
		border: "border-feedback-success",
		bg: "bg-feedback-success-subtle",
		text: "text-feedback-success",
	},
	important: {
		label: "Important",
		icon: CircleAlert,
		border: "border-primary",
		bg: "bg-primary-subtle",
		text: "text-primary",
	},
	warning: {
		label: "Warning",
		icon: TriangleAlert,
		border: "border-feedback-warning",
		bg: "bg-feedback-warning-subtle",
		text: "text-feedback-warning",
	},
	caution: {
		label: "Caution",
		icon: OctagonAlert,
		border: "border-feedback-error",
		bg: "bg-feedback-error-subtle",
		text: "text-feedback-error",
	},
};

function isVariant(v: unknown): v is AlertVariant {
	return v === "note" || v === "tip" || v === "important" || v === "warning" || v === "caution";
}

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
			className={`my-12 rounded-r-[var(--radius-sm)] border-l-2 py-8 pr-12 pl-12 text-text-default ${cfg.border} ${cfg.bg} [&>*:last-child]:mb-0 [&_p]:my-4`}
		>
			<p className={`tr-title-card mb-4 flex items-center gap-4 ${cfg.text}`}>
				<Icon className="size-16 shrink-0" />
				{cfg.label}
			</p>
			{children}
		</div>
	);
}

export const alertComponents = { mdalert: AlertCallout } as Components;
