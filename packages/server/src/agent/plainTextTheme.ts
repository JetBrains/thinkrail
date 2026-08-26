import { Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";

type ThemeBg = Parameters<Theme["bg"]>[0];

const FG_COLORS: ConstructorParameters<typeof Theme>[0] = {
	accent: "",
	border: "",
	borderAccent: "",
	borderMuted: "",
	success: "",
	error: "",
	warning: "",
	muted: "",
	dim: "",
	text: "",
	thinkingText: "",
	userMessageText: "",
	customMessageText: "",
	customMessageLabel: "",
	toolTitle: "",
	toolOutput: "",
	mdHeading: "",
	mdLink: "",
	mdLinkUrl: "",
	mdCode: "",
	mdCodeBlock: "",
	mdCodeBlockBorder: "",
	mdQuote: "",
	mdQuoteBorder: "",
	mdHr: "",
	mdListBullet: "",
	toolDiffAdded: "",
	toolDiffRemoved: "",
	toolDiffContext: "",
	syntaxComment: "",
	syntaxKeyword: "",
	syntaxFunction: "",
	syntaxVariable: "",
	syntaxString: "",
	syntaxNumber: "",
	syntaxType: "",
	syntaxOperator: "",
	syntaxPunctuation: "",
	thinkingOff: "",
	thinkingMinimal: "",
	thinkingLow: "",
	thinkingMedium: "",
	thinkingHigh: "",
	thinkingXhigh: "",
	thinkingMax: "",
	bashMode: "",
};

const BG_COLORS: ConstructorParameters<typeof Theme>[1] = {
	selectedBg: "",
	scrollbarThumb: "",
	userMessageBg: "",
	customMessageBg: "",
	toolPendingBg: "",
	toolSuccessBg: "",
	toolErrorBg: "",
};

class PlainTextTheme extends Theme {
	constructor() {
		super(FG_COLORS, BG_COLORS, "truecolor", { name: "thinkrail-web" });
	}

	override fg(_color: ThemeColor, text: string): string {
		return text;
	}

	override bg(_color: ThemeBg, text: string): string {
		return text;
	}

	override bold(text: string): string {
		return text;
	}

	override italic(text: string): string {
		return text;
	}

	override underline(text: string): string {
		return text;
	}

	override inverse(text: string): string {
		return text;
	}

	override strikethrough(text: string): string {
		return text;
	}

	override getFgAnsi(_color: ThemeColor): string {
		return "";
	}

	override getBgAnsi(_color: ThemeBg): string {
		return "";
	}
}

export const plainTextTheme: Theme = new PlainTextTheme();
