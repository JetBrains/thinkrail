import { useT } from "@thinkrail/locales/react";
import { Textarea } from "@thinkrail/ui/textarea";
import { useState } from "react";
import { Table } from "../parts/Section";
import type { PlaygroundValues, Showcase } from "./types";

const SAMPLE = "Review the open pull request and list blocking issues.";
const CODE_SAMPLE = "-y\n@modelcontextprotocol/server-filesystem\n.";

interface Cell {
	state: string;
	value: string;
	disabled?: boolean;
	readOnly?: boolean;
	code?: boolean;
}

const CELLS: readonly Cell[] = [
	{ state: "Empty", value: "" },
	{ state: "Filled", value: SAMPLE },
	{ state: "Disabled, empty", value: "", disabled: true },
	{ state: "Disabled, filled", value: SAMPLE, disabled: true },
	{ state: "Read-only", value: SAMPLE, readOnly: true },
	{ state: "Code-like content", value: CODE_SAMPLE, code: true },
];

function Specimen({ cell }: { cell: Cell }) {
	const t = useT();
	const [value, setValue] = useState(cell.value);
	return (
		<Textarea
			aria-label={cell.state}
			value={value}
			onChange={(event) => setValue(event.target.value)}
			placeholder={t("chat.templateEditor.bodyPlaceholder")}
			disabled={cell.disabled}
			readOnly={cell.readOnly}
			rows={3}
			className={cell.code ? "px-8 py-4 tr-code-text" : undefined}
		/>
	);
}

function StateMatrix() {
	return (
		<Table
			head={["State", "Live"]}
			rows={CELLS.map((cell) => [
				<span key="state" className="tr-text-emphasis">
					{cell.state}
				</span>,
				<div key="live" className="w-[18rem]">
					<Specimen cell={cell} />
				</div>,
			])}
		/>
	);
}

function Field({ values }: { values: PlaygroundValues }) {
	const t = useT();
	const code = values.content === "code";
	const [value, setValue] = useState(values.empty === true ? "" : code ? CODE_SAMPLE : SAMPLE);
	return (
		<Textarea
			aria-label={t("chat.templateEditor.body")}
			value={value}
			onChange={(event) => setValue(event.target.value)}
			placeholder={t("chat.templateEditor.bodyPlaceholder")}
			rows={Number(values.rows)}
			disabled={values.disabled === true}
			readOnly={values.readOnly === true}
			className={code ? "px-8 py-4 tr-code-text" : undefined}
		/>
	);
}

function Preview({ values }: { values: PlaygroundValues }) {
	return <Field key={`${values.content}-${values.empty === true}`} values={values} />;
}

function playgroundCode(values: PlaygroundValues) {
	const attributes = [
		"value={value}",
		"onChange={(event) => setValue(event.target.value)}",
		'placeholder={t("chat.templateEditor.bodyPlaceholder")}',
		`rows={${values.rows}}`,
		values.disabled === true ? "disabled" : null,
		values.readOnly === true ? "readOnly" : null,
		values.content === "code" ? 'className="px-8 py-4 tr-code-text"' : null,
	].filter(Boolean);
	return `<Textarea\n${attributes.map((line) => `\t${line}`).join("\n")}\n/>`;
}

export const textareaShowcase: Showcase = {
	sections: [{ id: "states", Render: StateMatrix }],
	playground: {
		controls: [
			{ kind: "choice", name: "rows", options: ["3", "6", "8", "14"] },
			{ kind: "choice", name: "content", options: ["text", "code"] },
			{ kind: "flag", name: "empty" },
			{ kind: "flag", name: "disabled" },
			{ kind: "flag", name: "readOnly" },
		],
		initial: { rows: "3", content: "text" },
		Preview,
		code: playgroundCode,
	},
};
