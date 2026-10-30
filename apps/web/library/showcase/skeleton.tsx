import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion, SkeletonRows } from "@thinkrail/ui/skeleton";
import { useRef, useState } from "react";
import { Table } from "../parts/Section";
import type { PlaygroundValues, Showcase } from "./types";

const ROW_COUNTS = [2, 3, 4, 5, 6, 8, 12] as const;

const code = (text: string) => (
	<code key="code" className="tr-code-text">
		{text}
	</code>
);

function RowCounts() {
	return (
		<Table
			head={["rows", "Placeholder"]}
			rows={ROW_COUNTS.map((rows) => [
				code(`rows={${rows}}`),
				<div key="live" className="w-[12rem]">
					<LoadingRegion rows={rows} />
				</div>,
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
			head={["Read time", "Live"]}
			rows={[
				["Resolves within the grace", <Replay key="live" resolveAfter={200} />],
				["Resolves after the grace", <Replay key="live" resolveAfter={1500} />],
				["Still pending", <Replay key="live" resolveAfter={null} />],
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
		{ id: "rows", Render: RowCounts },
		{ id: "states", Render: States },
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
