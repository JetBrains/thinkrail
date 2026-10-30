import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useRef, useState } from "react";
import { ConfirmDialog } from "@/panels/ConfirmDialog";
import type { PlaygroundValues, Showcase } from "./types";

function config(values: PlaygroundValues) {
	return {
		destructive: values.destructive === true,
		description: values.description === true,
		confirmLabel: values.confirmLabel === true,
	};
}

function Preview({ values }: { values: PlaygroundValues }) {
	const t = useT();
	const opener = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const { destructive, description, confirmLabel } = config(values);
	return (
		<>
			<Button ref={opener} variant="outline" onClick={() => setOpen(true)}>
				{t("common.remove")}
			</Button>
			<ConfirmDialog
				open={open}
				onOpenChange={setOpen}
				title={t("mcp.remove.title", { name: "github" })}
				{...(description
					? { description: t("mcp.remove.description", { source: "~/.pi/agent/mcp.json" }) }
					: {})}
				{...(confirmLabel ? { confirmLabel: t("common.remove") } : {})}
				destructive={destructive}
				onConfirm={() => {}}
				onClosedAutoFocus={() => opener.current?.focus()}
			/>
		</>
	);
}

function code(values: PlaygroundValues): string {
	const { destructive, description, confirmLabel } = config(values);
	return [
		"<ConfirmDialog",
		"\topen={open}",
		"\tonOpenChange={setOpen}",
		'\ttitle={t("mcp.remove.title", { name })}',
		...(description ? ['\tdescription={t("mcp.remove.description", { source })}'] : []),
		...(confirmLabel ? ['\tconfirmLabel={t("common.remove")}'] : []),
		...(destructive ? ["\tdestructive"] : []),
		"\tonConfirm={remove}",
		"\tonClosedAutoFocus={() => opener.current?.focus()}",
		"/>",
	].join("\n");
}

export const confirmDialogShowcase: Showcase = {
	sections: [],
	playground: {
		controls: [
			{ kind: "flag", name: "destructive" },
			{ kind: "flag", name: "description" },
			{ kind: "flag", name: "confirmLabel" },
		],
		initial: { destructive: true, description: true, confirmLabel: true },
		Preview,
		code,
	},
};
