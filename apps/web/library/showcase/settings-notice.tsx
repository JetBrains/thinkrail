import { RiMagicLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { SettingsNotice, type SettingsNoticeVariant } from "@/panels/SettingsNotice";
import {
	settingsNoticeIcons,
	settingsNoticeVariantDocs,
} from "../content/components/settings-notice";
import { InlineMarkdown } from "../parts/Markdown";
import { Table } from "../parts/Section";
import type { PlaygroundValues, Showcase } from "./types";

const VARIANTS = Object.keys(settingsNoticeVariantDocs) as SettingsNoticeVariant[];

const MESSAGE = {
	neutral: "settings.templates.projectEmpty",
	info: "settings.notifications.notGranted",
	success: "settings.github.connected",
	warning: "settings.notifications.blocked",
	error: "settings.appearance.custom.error.unreadable",
} as const satisfies Record<SettingsNoticeVariant, string>;
const SECOND_LINE = "settings.templates.globalEmptyDescription";
const ACTION = "settings.notifications.allowInBrowser";

interface Config {
	variant: SettingsNoticeVariant;
	secondLine: boolean;
	action: boolean;
	customIcon: boolean;
	hideIcon: boolean;
}

function Specimen({ variant, secondLine, action, customIcon, hideIcon }: Config) {
	const t = useT();
	return (
		<SettingsNotice
			variant={variant}
			hideIcon={hideIcon}
			icon={customIcon ? <RiMagicLine className="size-14" /> : undefined}
			action={
				action ? (
					<Button variant="outline" size="m" onClick={() => {}}>
						{t(ACTION)}
					</Button>
				) : null
			}
		>
			{secondLine ? (
				<>
					<p>{t(MESSAGE[variant])}</p>
					<p className="tr-text-metadata text-text-muted">{t(SECOND_LINE)}</p>
				</>
			) : (
				t(MESSAGE[variant])
			)}
		</SettingsNotice>
	);
}

function Variants() {
	return (
		<Table
			head={["Variant", "Notice", "Default icon", "Use it for"]}
			rows={VARIANTS.map((variant) => [
				<code key="variant" className="tr-code-text">
					{variant}
				</code>,
				<Specimen
					key="notice"
					variant={variant}
					secondLine={false}
					action={false}
					customIcon={false}
					hideIcon={false}
				/>,
				<code key="icon" className="tr-code-text">
					{settingsNoticeIcons[variant]}
				</code>,
				<InlineMarkdown key="text" source={settingsNoticeVariantDocs[variant]} />,
			])}
		/>
	);
}

function toConfig(values: PlaygroundValues): Config {
	return {
		variant: values.variant as SettingsNoticeVariant,
		secondLine: values.secondLine === true,
		action: values.action === true,
		customIcon: values.customIcon === true,
		hideIcon: values.hideIcon === true,
	};
}

function code(values: PlaygroundValues): string {
	const { variant, secondLine, action, customIcon, hideIcon } = toConfig(values);
	const props = [
		`variant="${variant}"`,
		...(hideIcon ? ["hideIcon"] : []),
		...(customIcon ? ['icon={<RiMagicLine className="size-14" />}'] : []),
	];
	const open = action
		? [
				`<SettingsNotice`,
				...props.map((prop) => `\t${prop}`),
				`\taction={`,
				`\t\t<Button variant="outline" size="m" onClick={allow}>`,
				`\t\t\t{t("${ACTION}")}`,
				`\t\t</Button>`,
				`\t}`,
				`>`,
			]
		: [`<SettingsNotice ${props.join(" ")}>`];
	const body = secondLine
		? [
				`\t<p>{t("${MESSAGE[variant]}")}</p>`,
				`\t<p className="tr-text-metadata text-text-muted">{t("${SECOND_LINE}")}</p>`,
			]
		: [`\t{t("${MESSAGE[variant]}")}`];
	return [...open, ...body, `</SettingsNotice>`].join("\n");
}

export const settingsNoticeShowcase: Showcase = {
	sections: [{ id: "variants", Render: Variants }],
	playground: {
		controls: [
			{ kind: "choice", name: "variant", options: VARIANTS },
			{ kind: "flag", name: "secondLine" },
			{ kind: "flag", name: "action" },
			{ kind: "flag", name: "customIcon" },
			{ kind: "flag", name: "hideIcon" },
		],
		initial: { variant: "warning", secondLine: false, action: true },
		Preview: ({ values }) => <Specimen {...toConfig(values)} />,
		code,
	},
};
