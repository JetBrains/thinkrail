import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Text,
	TruncatedText,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import {
	isNextStepsDetails,
	MAX_SHORTCUTS,
	type NextStepsArgs,
	normalizeSuggestions,
} from "./core.ts";

function countLabel(count: number): string {
	return `Suggested ${count} next step${count === 1 ? "" : "s"}`;
}

export function renderNextStepsCall(
	args: Partial<NextStepsArgs> | undefined,
	theme: Theme,
): Component {
	const count = normalizeSuggestions(
		Array.isArray(args?.suggestions) ? args.suggestions : [],
	).length;
	return new TruncatedText(
		theme.fg("toolTitle", theme.bold("suggest_next_steps ")) + theme.fg("muted", countLabel(count)),
		0,
		0,
	);
}

export function renderNextStepsResult(result: AgentToolResult<unknown>, theme: Theme): Component {
	const suggestions = isNextStepsDetails(result.details) ? result.details.suggestions : [];
	if (suggestions.length === 0) return new Text(theme.fg("muted", "No usable suggestions."), 0, 0);
	return new Text(
		suggestions
			.map(
				(suggestion, index) =>
					`${theme.fg("dim", `${index + 1}.`)} ${theme.fg("text", suggestion)}`,
			)
			.join("\n"),
		0,
		0,
	);
}

export function shortcutLabel(index: number, platform: string = process.platform): string {
	return platform === "darwin" ? `⌥${index + 1}` : `Alt+${index + 1}`;
}

export class SuggestionRow implements Component {
	private readonly suggestions: readonly string[];
	private readonly theme: Theme;
	private readonly platform: string;

	constructor(suggestions: readonly string[], theme: Theme, platform: string = process.platform) {
		this.suggestions = suggestions;
		this.theme = theme;
		this.platform = platform;
	}

	render(width: number): string[] {
		const gap = "   ";
		const lines: string[] = [];
		let line = "";
		this.suggestions.slice(0, MAX_SHORTCUTS).forEach((suggestion, index) => {
			const chip = `${this.theme.fg("accent", shortcutLabel(index, this.platform))} ${this.theme.fg("text", suggestion)}`;
			const candidate = line ? `${line}${gap}${chip}` : ` ${chip}`;
			if (line && visibleWidth(candidate) > width) {
				lines.push(line);
				line = ` ${chip}`;
			} else {
				line = candidate;
			}
		});
		if (line) lines.push(line);
		return lines.map((text) => truncateToWidth(text, width));
	}

	invalidate(): void {}
}
