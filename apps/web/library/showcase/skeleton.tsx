import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion, SkeletonRows } from "@thinkrail/ui/skeleton";
import { useRef, useState } from "react";
import { Table } from "../parts/Section";
import type { PlaygroundValues, Showcase } from "./types";

const ROW_COUNTS = [
	{
		rows: 2,
		use: "A short sub-list: workspaces under an expanded project, the Extensions catalog.",
	},
	{ rows: 3, use: "A settings section, a menu's commit section." },
	{
		rows: 4,
		use: "A dialog list (existing worktrees, skills), one file section of the review tab.",
	},
	{ rows: 5, use: "A side-panel list: Changes, Review." },
	{ rows: 6, use: "The default; the Specs panel." },
	{ rows: 8, use: "The file tree, the review tab, a plan or a resource preview pane." },
	{ rows: 12, use: "A restoring tab body, a file or diff pane. The maximum." },
] as const;

const code = (text: string) => (
	<code key="code" className="tr-code-text">
		{text}
	</code>
);

function RowCounts() {
	return (
		<Table
			head={["rows", "Placeholder", "Used for"]}
			rows={ROW_COUNTS.map(({ rows, use }) => [
				code(`rows={${rows}}`),
				<div key="live" className="w-[12rem]">
					<LoadingRegion rows={rows} />
				</div>,
				use,
			])}
		/>
	);
}

function Replay({ resolveAfter }: { resolveAfter: number | null }) {
	const [run, setRun] = useState(0);
	const [done, setDone] = useState(false);
	const timer = useRef(0);
	const start = () => {
		window.clearTimeout(timer.current);
		setDone(false);
		setRun((value) => value + 1);
		if (resolveAfter !== null) timer.current = window.setTimeout(() => setDone(true), resolveAfter);
	};
	return (
		<div className="flex w-[14rem] flex-col items-start gap-8">
			<Button variant="outline" size="s" onClick={start}>
				Mount
			</Button>
			<div className="h-64 w-full">
				{run === 0 ? null : done ? (
					<p className="tr-text-ui text-text-default motion-safe:animate-reveal">Content</p>
				) : (
					<LoadingRegion key={run} rows={4} />
				)}
			</div>
		</div>
	);
}

function States() {
	return (
		<Table
			head={["Read time", "Live", "What you see"]}
			rows={[
				[
					"Resolves within the grace",
					<Replay key="live" resolveAfter={200} />,
					"The region keeps its space but never shows bars; the content fades in.",
				],
				[
					"Resolves after the grace",
					<Replay key="live" resolveAfter={1500} />,
					"The bars fade in, pulse, then give way to the content.",
				],
				[
					"Still pending",
					<Replay key="live" resolveAfter={null} />,
					"The bars fade in and keep pulsing until the read lands.",
				],
			]}
		/>
	);
}

function PlaygroundPreview({ values }: { values: PlaygroundValues }) {
	const t = useT();
	const rows = Number(values.rows);
	const label = values.label === true ? t("shell.workbench.restoring.chat") : undefined;
	return (
		<div className="w-full">
			{values.component === "SkeletonRows" ? (
				<SkeletonRows rows={rows} {...(label ? { label } : {})} />
			) : (
				<LoadingRegion rows={rows} className="px-8 py-4" {...(label ? { label } : {})} />
			)}
		</div>
	);
}

function playgroundCode(values: PlaygroundValues) {
	const attrs = [
		`rows={${values.rows}}`,
		values.label === true ? 'label={t("shell.workbench.restoring.chat")}' : null,
		values.component === "SkeletonRows" ? null : 'className="px-8 py-4"',
	].filter((attr): attr is string => attr !== null);
	return `<${values.component} ${attrs.join(" ")} />`;
}

export const skeletonShowcase: Showcase = {
	sections: [
		{
			id: "rows",
			title: "Row counts",
			description:
				"Every cell is the real `LoadingRegion`. Bars follow one fixed width sequence, so a count only adds or removes rows from the end; counts above 12 are clamped.",
			Render: RowCounts,
		},
		{
			id: "states",
			title: "States",
			description:
				"Press Mount to mount a fresh placeholder and watch the grace, the fade-in and the pulse. The resolved text carries `motion-safe:animate-reveal`, as resolved content does in the app.",
			Render: States,
		},
	],
	playground: {
		controls: [
			{ kind: "choice", name: "component", options: ["LoadingRegion", "SkeletonRows"] },
			{ kind: "choice", name: "rows", options: ["2", "3", "4", "5", "6", "8", "12"] },
			{ kind: "flag", name: "label" },
		],
		initial: { component: "LoadingRegion", rows: "6" },
		Preview: PlaygroundPreview,
		code: playgroundCode,
	},
};
