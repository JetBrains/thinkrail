import { type Check, checks, type EventLog, type Signal } from "./harness";

export const MAX_MOCKUP_BYTES = 256 * 1024;

export interface MockupArtifact {
	location: string;
	html: string;
}

const MOCKUP_FENCE = /(`{3,}|~{3,})[ \t]*mockup\b[^\n]*\n([\s\S]*?)\n[ \t]*\1/g;

function fenced(text: string, location: string): MockupArtifact[] {
	return [...text.matchAll(MOCKUP_FENCE)].map((match, index) => ({
		location: `${location} fence ${index + 1}`,
		html: match[2] ?? "",
	}));
}

function text(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

export function mockupArtifacts(log: EventLog): MockupArtifact[] {
	const artifacts: MockupArtifact[] = [];
	for (const [callIndex, call] of log.toolCalls("visualize").entries()) {
		if (call.isError) continue;
		const where = `visualize #${callIndex + 1}`;
		for (const key of ["html", "before", "after"] as const) {
			const html = text(call.args[key]);
			if (html !== null) artifacts.push({ location: `${where} ${key}`, html });
		}
		const options = Array.isArray(call.args.options) ? call.args.options : [];
		for (const [index, option] of options.entries()) {
			const html = text((option as Record<string, unknown> | null)?.html);
			if (html !== null) artifacts.push({ location: `${where} options[${index}].html`, html });
		}
	}
	for (const [callIndex, call] of log.toolCalls("ask_user_question").entries()) {
		const questions = Array.isArray(call.args.questions) ? call.args.questions : [];
		for (const [qi, question] of questions.entries()) {
			const options = (question as { options?: unknown })?.options;
			for (const [oi, option] of (Array.isArray(options) ? options : []).entries()) {
				const preview = text((option as Record<string, unknown> | null)?.preview);
				if (preview !== null) {
					artifacts.push(...fenced(preview, `ask #${callIndex + 1} q${qi + 1} option ${oi + 1}`));
				}
			}
		}
	}
	for (const [index, reply] of log.assistantTexts().entries()) {
		artifacts.push(...fenced(reply, `assistant reply ${index + 1}`));
	}
	return artifacts;
}

const REMOTE_RESOURCE =
	/(?:\b(?:src|href|srcset|poster)\s*=\s*["']?\s*(?:https?:)?\/\/)|(?:url\(\s*["']?\s*(?:https?:)?\/\/)|(?:@import\s+(?:url\()?\s*["']?\s*(?:https?:)?\/\/)/i;
const VISUAL_ELEMENT = /<(?:img|svg|input|button|select|textarea|hr|progress|meter)\b/i;

export function visibleText(html: string): string {
	return html
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<(style|script|head|title)\b[\s\S]*?<\/\1\s*>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;|&#160;/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function bindingProblems(html: string): string[] {
	const problems: string[] = [];
	if (visibleText(html) === "" && !VISUAL_ELEMENT.test(html)) problems.push("no visible content");
	if (/<script[\s>]/i.test(html)) problems.push("contains <script>");
	if (REMOTE_RESOURCE.test(html)) problems.push("loads an http(s) resource");
	if (new TextEncoder().encode(html).length > MAX_MOCKUP_BYTES) problems.push("over 256 KB");
	return problems;
}

const BALANCED_TAGS = ["div", "section", "nav", "header", "main", "footer", "aside", "ul", "form"];

export function advisoryProblems(html: string): string[] {
	const problems: string[] = [];
	if (!/<style[\s>]|\sstyle\s*=/i.test(html)) problems.push("no styling");
	const elements = html.match(/<[a-z][a-z0-9-]*(?=[\s>/])/gi)?.length ?? 0;
	if (elements < 5) problems.push(`only ${elements} element(s)`);
	for (const tag of BALANCED_TAGS) {
		const open = html.match(new RegExp(`<${tag}(?=[\\s>])`, "gi"))?.length ?? 0;
		const close = html.match(new RegExp(`</${tag}\\s*>`, "gi"))?.length ?? 0;
		if (open !== close) problems.push(`<${tag}> opened ${open}× but closed ${close}×`);
	}
	if (/\son[a-z]+\s*=/i.test(html)) problems.push("uses on* event handlers");
	return problems;
}

function report(artifacts: MockupArtifact[], problemsOf: (html: string) => string[]): string {
	const lines = artifacts.flatMap(({ location, html }) => {
		const problems = problemsOf(html);
		return problems.length === 0 ? [] : [`${location}: ${problems.join(", ")}`];
	});
	return lines.length === 0 ? `${artifacts.length} mockup(s) ok` : lines.join("; ");
}

export const mockupSignals = {
	shown(): Signal {
		return {
			description: "a mockup was shown",
			test: (log) => mockupArtifacts(log).length > 0,
		};
	},
};

export const mockupChecks = {
	shown(minimum = 1): Check {
		const name = `at least ${minimum} mockup(s) shown`;
		return {
			name,
			run: ({ log }) => {
				const count = mockupArtifacts(log).length;
				return { name, pass: count >= minimum, detail: `${count} mockup(s)` };
			},
		};
	},
	pairShown(): Check {
		return checks.custom("a before/after mockup was shown", ({ log }) =>
			log
				.toolCalls("visualize")
				.some(
					(call) =>
						!call.isError &&
						call.args.type === "mockup" &&
						typeof call.args.before === "string" &&
						typeof call.args.after === "string",
				),
		);
	},
	optionsShown(minimum = 2): Check {
		const name = `alternatives with at least ${minimum} mockups shown`;
		return {
			name,
			run: ({ log }) => {
				const perSurface = [
					...log
						.toolCalls("visualize")
						.filter((call) => !call.isError && call.args.type === "comparison")
						.map(
							(call) =>
								(Array.isArray(call.args.options) ? call.args.options : []).filter(
									(option) => typeof (option as Record<string, unknown>)?.html === "string",
								).length,
						),
					...log
						.toolCalls("ask_user_question")
						.flatMap((call) =>
							(Array.isArray(call.args.questions) ? call.args.questions : []).map(
								(question) =>
									((question as { options?: unknown[] }).options ?? []).filter((option) =>
										/(`{3,}|~{3,})[ \t]*mockup\b/.test(
											String((option as Record<string, unknown>)?.preview ?? ""),
										),
									).length,
							),
						),
				];
				const best = Math.max(0, ...perSurface);
				return { name, pass: best >= minimum, detail: `most mockups on one surface: ${best}` };
			},
		};
	},
	valid(): Check {
		const name = "every mockup is non-empty, script-free, self-contained and within the cap";
		return {
			name,
			run: ({ log }) => {
				const artifacts = mockupArtifacts(log);
				const detail = report(artifacts, bindingProblems);
				const pass =
					artifacts.length > 0 && artifacts.every(({ html }) => bindingProblems(html).length === 0);
				return { name, pass, detail };
			},
		};
	},
	wellFormed(): Check {
		const name = "mockups are styled, substantial and well-formed";
		return {
			name,
			run: ({ log }) => {
				const artifacts = mockupArtifacts(log);
				return {
					name,
					pass: artifacts.every(({ html }) => advisoryProblems(html).length === 0),
					detail: report(artifacts, advisoryProblems),
				};
			},
		};
	},
	reuses(label: string, pattern: RegExp): Check {
		const name = `a mockup reuses the project's ${label}`;
		return {
			name,
			run: ({ log }) => {
				const hit = mockupArtifacts(log).some(({ html }) => pattern.test(html));
				return { name, pass: hit, detail: hit ? "found" : `no mockup matches ${pattern}` };
			},
		};
	},
};

export function mockupJudgeContext(log: EventLog, maxChars = 6000): string {
	const body = mockupArtifacts(log)
		.map(({ location, html }) => `--- ${location} ---\n${html}`)
		.join("\n\n");
	return body.length > maxChars ? `${body.slice(0, maxChars)}\n…(truncated)` : body;
}
