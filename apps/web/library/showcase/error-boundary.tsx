import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Table } from "../parts/Section";
import type { PlaygroundValues, Showcase } from "./types";

const MESSAGES = {
	message: "Cannot read properties of undefined (reading 'title')",
	empty: "",
	chunk: "Failed to fetch dynamically imported module: /assets/FilePane.js",
} as const;
type ErrorKind = keyof typeof MESSAGES;
const THROWS = {
	message: "throws while rendering",
	empty: "throws an error with no message",
	chunk: "a lazy import() fails",
} as const satisfies Record<ErrorKind, string>;
const LABELS = ["none", "editor", "chat", "terminal"] as const;
type Label = (typeof LABELS)[number];

function Thrower({ kind }: { kind: ErrorKind }) {
	const t = useT();
	const [opened, setOpened] = useState(false);
	if (opened) throw new Error(MESSAGES[kind]);
	return (
		<div className="flex h-full items-center justify-center">
			<Button variant="outline" size="m" onClick={() => setOpened(true)}>
				{t("panels.diffSurface.openFile")}
			</Button>
		</div>
	);
}

function Live({ kind, label }: { kind: ErrorKind; label: Label }) {
	const t = useT();
	return (
		<div className="h-[11rem] w-[22rem]">
			<ErrorBoundary
				{...(label === "none" ? {} : { label: t(`shell.workbench.panel.${label}`) })}
				reportId={label === "none" ? "app" : label}
			>
				<Thrower kind={kind} />
			</ErrorBoundary>
		</div>
	);
}

const CASES: readonly { name: string; kind: ErrorKind; label: Label; shows: string }[] = [
	{
		name: "Render error, labelled",
		kind: "message",
		label: "editor",
		shows: "“The editor panel hit an error”, the error message and Try again.",
	},
	{
		name: "Render error, no label",
		kind: "message",
		label: "none",
		shows: "“Something went wrong”, the error message and Try again.",
	},
	{
		name: "Empty message",
		kind: "empty",
		label: "editor",
		shows: "The generic “An unexpected error occurred…” line instead of a blank message.",
	},
	{
		name: "Chunk load error",
		kind: "chunk",
		label: "editor",
		shows: "The stale-chunk explanation and Reload page, which reloads the page.",
	},
];

function Fallbacks() {
	return (
		<Table
			head={["Case", "Live", "Fallback"]}
			rows={CASES.map((item) => [
				<span key="name" className="tr-text-emphasis">
					{item.name}
				</span>,
				<Live key="live" kind={item.kind} label={item.label} />,
				item.shows,
			])}
		/>
	);
}

function config(values: PlaygroundValues) {
	return { label: values.label as Label, kind: values.error as ErrorKind };
}

export const errorBoundaryShowcase: Showcase = {
	sections: [
		{
			id: "states",
			title: "Fallbacks",
			description:
				"Every cell is a real boundary around a child that throws while rendering. Press Open file to crash it; Try again remounts the child.",
			Render: Fallbacks,
		},
	],
	playground: {
		controls: [
			{ kind: "choice", name: "label", options: LABELS },
			{ kind: "choice", name: "error", options: Object.keys(MESSAGES) },
		],
		initial: { label: "editor", error: "message" },
		Preview: ({ values }) => {
			const { label, kind } = config(values);
			return <Live key={`${label}-${kind}`} kind={kind} label={label} />;
		},
		code: (values) => {
			const { label, kind } = config(values);
			return [
				"<ErrorBoundary",
				...(label === "none" ? [] : [`\tlabel={t("shell.workbench.panel.${label}")}`]),
				`\treportId="${label === "none" ? "app" : label}"`,
				"\tresetKeys={[workspaceId, tab.id]}",
				">",
				`\t<Panel /> {/* ${THROWS[kind]} */}`,
				"</ErrorBoundary>",
			].join("\n");
		},
	},
};
