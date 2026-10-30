import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@thinkrail/ui/dialog";
import type { PlaygroundValues, Showcase } from "./types";

const FOOTERS = ["two actions", "one action", "none"] as const;
type Footer = (typeof FOOTERS)[number];

function config(values: PlaygroundValues) {
	return {
		hideClose: values.hideClose === true,
		description: values.description === true,
		footer: (values.footer as Footer | undefined) ?? "two actions",
	};
}

function Preview({ values }: { values: PlaygroundValues }) {
	const t = useT();
	const { hideClose, description, footer } = config(values);
	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button variant="outline">{t("settings.notifications.enable")}</Button>
			</DialogTrigger>
			<DialogContent
				hideClose={hideClose}
				{...(description ? {} : { "aria-describedby": undefined })}
			>
				<DialogHeader>
					<DialogTitle>{t("notifications.permission.title")}</DialogTitle>
					{description ? (
						<DialogDescription>{t("notifications.permission.description")}</DialogDescription>
					) : null}
				</DialogHeader>
				{footer === "none" ? null : (
					<DialogFooter>
						{footer === "two actions" ? (
							<DialogClose asChild>
								<Button variant="outline">{t("notifications.permission.notNow")}</Button>
							</DialogClose>
						) : null}
						<DialogClose asChild>
							<Button>{t("notifications.permission.enable")}</Button>
						</DialogClose>
					</DialogFooter>
				)}
			</DialogContent>
		</Dialog>
	);
}

function code(values: PlaygroundValues): string {
	const { hideClose, description, footer } = config(values);
	const content = [
		hideClose ? " hideClose" : "",
		description ? "" : " aria-describedby={undefined}",
	]
		.join("")
		.trimEnd();
	const lines = [
		"<Dialog>",
		"\t<DialogTrigger asChild>",
		'\t\t<Button variant="outline">{t("settings.notifications.enable")}</Button>',
		"\t</DialogTrigger>",
		`\t<DialogContent${content}>`,
		"\t\t<DialogHeader>",
		'\t\t\t<DialogTitle>{t("notifications.permission.title")}</DialogTitle>',
		...(description
			? ['\t\t\t<DialogDescription>{t("notifications.permission.description")}</DialogDescription>']
			: []),
		"\t\t</DialogHeader>",
		...(footer === "none"
			? []
			: [
					"\t\t<DialogFooter>",
					...(footer === "two actions"
						? [
								"\t\t\t<DialogClose asChild>",
								'\t\t\t\t<Button variant="outline">{t("notifications.permission.notNow")}</Button>',
								"\t\t\t</DialogClose>",
							]
						: []),
					"\t\t\t<DialogClose asChild>",
					'\t\t\t\t<Button>{t("notifications.permission.enable")}</Button>',
					"\t\t\t</DialogClose>",
					"\t\t</DialogFooter>",
				]),
		"\t</DialogContent>",
		"</Dialog>",
	];
	return lines.join("\n");
}

export const dialogShowcase: Showcase = {
	sections: [],
	playground: {
		controls: [
			{ kind: "choice", name: "footer", options: FOOTERS },
			{ kind: "flag", name: "description" },
			{ kind: "flag", name: "hideClose" },
		],
		initial: { footer: "two actions", description: true, hideClose: false },
		Preview,
		code,
	},
};
