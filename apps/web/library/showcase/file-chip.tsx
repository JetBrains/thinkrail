import { RiCloseLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import type { ReactNode } from "react";
import { FileChip } from "@/chat/FileChip";
import { fileChip } from "../content/components/file-chip";
import { InlineMarkdown } from "../parts/Markdown";
import { Table } from "../parts/Section";
import type { PlaygroundValues, Showcase } from "./types";

type Tone = keyof typeof fileChip.tones.docs;

const TONES = Object.keys(fileChip.tones.docs) as Tone[];
const SHORT = "screenshot.png";
const LONG = "Screenshot 2025-03-14 at 09.41.27 — design review, second pass.png";

const code = (text: string) => (
	<code key="name" className="tr-code-text">
		{text}
	</code>
);

function Remove() {
	const t = useT();
	return (
		<IconButton
			icon={RiCloseLine}
			size="s"
			label={t("chat.promptImages.remove")}
			onClick={() => {}}
		/>
	);
}

function Cell({ children }: { children: ReactNode }) {
	return <div className="flex flex-wrap gap-4">{children}</div>;
}

function ToneMatrix() {
	return (
		<>
			<Table
				head={["Tone", "Label", "icon={false}", "meta + trailing"]}
				rows={TONES.map((tone) => [
					code(tone),
					<Cell key="label">
						<FileChip tone={tone} label={SHORT} />
					</Cell>,
					<Cell key="no-icon">
						<FileChip tone={tone} icon={false} label={SHORT} />
					</Cell>,
					<Cell key="meta">
						<FileChip tone={tone} label={SHORT} meta=" · 1280×720" trailing={<Remove />} />
					</Cell>,
				])}
			/>
			<Table
				head={["Tone", "Use it for"]}
				rows={TONES.map((tone) => [
					code(tone),
					<InlineMarkdown key="text" source={fileChip.tones.docs[tone]} />,
				])}
			/>
		</>
	);
}

function StateMatrix() {
	const t = useT();
	return (
		<Table
			head={["State", "Live"]}
			rows={[
				["Static", <FileChip key="live" label={SHORT} meta=" · 1280×720" />],
				[
					"Hover · Tab (onClick)",
					<FileChip key="live" label={SHORT} aria-label={SHORT} onClick={() => {}} />,
				],
				[
					"Truncated",
					<div key="live" className="flex w-full max-w-[14rem]">
						<FileChip label={LONG} title={LONG} meta=" · 2880×1800" trailing={<Remove />} />
					</div>,
				],
				[
					"Pending",
					<FileChip
						key="live"
						label={
							<span className="text-text-muted">
								{t("chat.promptImages.attaching", { count: 2 })}
							</span>
						}
					/>,
				],
				[
					"Error",
					<FileChip
						key="live"
						tone="error"
						icon={false}
						label={t("chat.promptImages.attachFailed", { name: "photo.heic" })}
						meta={`— ${t("chat.promptImages.unsupported")}`}
					/>,
				],
			].map(([state, live]) => [
				<span key="state" className="tr-text-emphasis">
					{state}
				</span>,
				<Cell key="live">{live}</Cell>,
			])}
		/>
	);
}

function PlaygroundChip({ values }: { values: PlaygroundValues }) {
	const label = values.label === "long" ? LONG : SHORT;
	const clickable = values.onClick === true;
	return (
		<div className="flex w-full max-w-[16rem] justify-center">
			<FileChip
				tone={values.tone as Tone}
				icon={values.icon === true}
				title={label}
				label={label}
				{...(values.meta === true ? { meta: " · 1280×720" } : {})}
				{...(values.trailing === true && !clickable ? { trailing: <Remove /> } : {})}
				{...(clickable ? { "aria-label": label, onClick: () => {} } : {})}
			/>
		</div>
	);
}

function playgroundCode(values: PlaygroundValues) {
	const label = values.label === "long" ? LONG : SHORT;
	const clickable = values.onClick === true;
	const lines = [
		values.tone === "error" ? 'tone="error"' : null,
		values.icon === true ? null : "icon={false}",
		`title="${label}"`,
		`label="${label}"`,
		values.meta === true ? 'meta=" · 1280×720"' : null,
		values.trailing === true && !clickable
			? 'trailing={\n\t\t<IconButton\n\t\t\ticon={RiCloseLine}\n\t\t\tsize="s"\n\t\t\tlabel={t("chat.promptImages.remove")}\n\t\t\tonClick={remove}\n\t\t/>\n\t}'
			: null,
		clickable ? 'aria-label={t("chat.turn.viewAttachment", { label })}' : null,
		clickable ? "onClick={open}" : null,
	].filter((line): line is string => line !== null);
	return `<FileChip\n${lines.map((line) => `\t${line}`).join("\n")}\n/>`;
}

export const fileChipShowcase: Showcase = {
	sections: [
		{
			id: "tone",
			title: "Tone",
			description: fileChip.tones.note,
			Render: ToneMatrix,
		},
		{
			id: "states",
			title: "States",
			description:
				"Every cell is the real component. Hover the clickable chip, or click into the page and press Tab to see its focus ring.",
			Render: StateMatrix,
		},
	],
	playground: {
		controls: [
			{ kind: "choice", name: "tone", options: TONES },
			{ kind: "choice", name: "label", options: ["short", "long"] },
			{ kind: "flag", name: "icon" },
			{ kind: "flag", name: "meta" },
			{ kind: "flag", name: "trailing" },
			{ kind: "flag", name: "onClick" },
		],
		initial: { tone: "default", label: "short", icon: true, meta: true, trailing: true },
		Preview: PlaygroundChip,
		code: playgroundCode,
	},
};
