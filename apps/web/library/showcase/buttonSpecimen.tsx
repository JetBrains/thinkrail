import { RiAddLine, RiArrowDownSLine, RiDeleteBinLine } from "@remixicon/react";
import {
	Button,
	type ButtonSize,
	type ButtonTone,
	type ButtonVariant,
	IconButton,
} from "@thinkrail/ui/button";

export type Kind = "button" | "icon-button";
export type Content = "text" | "icon left" | "icon right" | "both icons";

export interface SpecimenConfig {
	variant: ButtonVariant;
	size: ButtonSize;
	tone?: ButtonTone | undefined;
	loading?: boolean;
	spinIcon?: boolean;
	selected?: boolean;
	disabled?: boolean;
	content?: Content;
	label?: string;
}

const ICON_LEFT: Record<Content, boolean> = {
	text: false,
	"icon left": true,
	"icon right": false,
	"both icons": true,
};
const ICON_RIGHT: Record<Content, boolean> = {
	text: false,
	"icon left": false,
	"icon right": true,
	"both icons": true,
};

export function specimenLabel(config: Pick<SpecimenConfig, "variant" | "label">): string {
	return config.label ?? (config.variant === "destructive" ? "Delete" : "Action");
}

export function Specimen({ kind, config }: { kind: Kind; config: SpecimenConfig }) {
	const { variant, size, tone, loading, spinIcon, selected, disabled } = config;
	const shared = {
		variant,
		size,
		tone,
		...(loading ? { loading } : {}),
		...(spinIcon ? { spinIcon } : {}),
		...(selected ? { selected, "aria-pressed": true } : {}),
		...(disabled ? { disabled } : {}),
	};
	const label = specimenLabel(config);
	if (kind === "icon-button")
		return (
			<IconButton
				{...shared}
				icon={variant === "destructive" ? RiDeleteBinLine : RiAddLine}
				label={label}
			/>
		);
	const content = config.content ?? "text";
	return (
		<Button
			{...shared}
			{...(ICON_LEFT[content]
				? { iconLeft: variant === "destructive" ? RiDeleteBinLine : RiAddLine }
				: {})}
			{...(ICON_RIGHT[content] ? { iconRight: RiArrowDownSLine } : {})}
		>
			{label}
		</Button>
	);
}

export function specimenCode(kind: Kind, config: SpecimenConfig): string {
	const content = config.content ?? "text";
	const props: string[] = [`variant="${config.variant}"`, `size="${config.size}"`];
	if (config.tone) props.push(`tone="${config.tone}"`);
	const icon = config.variant === "destructive" ? "RiDeleteBinLine" : "RiAddLine";
	const icons: string[] = [];
	if (kind === "icon-button") {
		props.push(`icon={${icon}}`, 'label={t("…")}');
		icons.push(icon);
	} else {
		if (ICON_LEFT[content]) {
			props.push(`iconLeft={${icon}}`);
			icons.push(icon);
		}
		if (ICON_RIGHT[content]) {
			props.push("iconRight={RiArrowDownSLine}");
			icons.push("RiArrowDownSLine");
		}
	}
	if (config.loading) props.push("loading");
	if (config.spinIcon) props.push("spinIcon");
	if (config.selected) props.push("selected", "aria-pressed");
	if (config.disabled) props.push("disabled");
	const name = kind === "icon-button" ? "IconButton" : "Button";
	const imports = [
		icons.length
			? `import { ${[...new Set(icons)].sort().join(", ")} } from "@remixicon/react";`
			: "",
		`import { ${name} } from "@thinkrail/ui/button";`,
	].filter(Boolean);
	const open = `<${name}\n\t${props.join("\n\t")}`;
	const jsx = kind === "icon-button" ? `${open}\n/>` : `${open}\n>\n\t{t("…")}\n</${name}>`;
	return `${imports.join("\n")}\n\n${jsx}`;
}
