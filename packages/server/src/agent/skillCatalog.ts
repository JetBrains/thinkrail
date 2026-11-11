import type { Api, Model } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	formatSkillsForPrompt,
	parseSkillBlock,
	type SessionEntry,
	type Skill,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { SKILL_LISTING_MAX_TOKENS, SKILL_LISTING_MIN_TOKENS } from "@thinkrail/contracts";
import { Type } from "typebox";
import type { CompatibilitySkillProvider } from "./skillSources";

export const SKILL_SEARCH_TOOL = "skill_search";
const CATALOG_WINDOW_SHARE = 0.02;
const CATALOG_WINDOW_CEILING = 0.1;
const CHARS_PER_TOKEN = 4;
const DESCRIPTION_CHARS = 240;
const SEARCH_DEFAULT_LIMIT = 8;
const SEARCH_MAX_LIMIT = 20;
const DISTINCTIVE_SHARE = 0.05;
const HINT_LIMIT = 3;
export const SKILL_HINT_CUSTOM_TYPE = "thinkrail/skill-hint";
const PI_VIRTUAL_MODEL_API = "pi-virtual";
const FOREIGN_SOURCES: ReadonlySet<string> = new Set<CompatibilitySkillProvider>([
	"claude",
	"codex",
	"github-copilot",
	"gemini",
]);

export function catalogBudgetChars(model: Model<Api> | undefined): number {
	const known = model && model.api !== PI_VIRTUAL_MODEL_API && model.contextWindow > 0;
	if (!known) return SKILL_LISTING_MIN_TOKENS * CHARS_PER_TOKEN;
	const share = Math.max(SKILL_LISTING_MIN_TOKENS, model.contextWindow * CATALOG_WINDOW_SHARE);
	const tokens = Math.floor(
		Math.min(SKILL_LISTING_MAX_TOKENS, share, model.contextWindow * CATALOG_WINDOW_CEILING),
	);
	return tokens * CHARS_PER_TOKEN;
}

function tier(skill: Skill): number {
	const scope = skill.sourceInfo.scope;
	if (scope === "project") return 0;
	if (scope === "temporary") return 1;
	return FOREIGN_SOURCES.has(skill.sourceInfo.source) ? 3 : 2;
}

export function rankSkills(skills: readonly Skill[]): Skill[] {
	return skills
		.filter((skill) => !skill.disableModelInvocation)
		.map((skill, index) => ({ skill, index, tier: tier(skill) }))
		.sort((a, b) => a.tier - b.tier || a.index - b.index)
		.map(({ skill }) => skill);
}

function shorten(text: string, max: number): string {
	const flat = text.replace(/\s+/g, " ").trim();
	if (flat.length <= max) return flat;
	const cut = flat.slice(0, max - 1);
	const space = cut.lastIndexOf(" ");
	return `${space > max / 2 ? cut.slice(0, space) : cut}…`;
}

function skillLine(skill: Skill): string {
	return `- ${skill.name}: ${shorten(skill.description, DESCRIPTION_CHARS)}\n  location: ${skill.filePath}`;
}

function sourceLabel(skill: Skill): string {
	return skill.sourceInfo.scope === "project" ? "project" : skill.sourceInfo.source || "other";
}

function unlistedSummary(skills: readonly Skill[]): string {
	const counts = new Map<string, number>();
	for (const skill of skills) {
		const label = sourceLabel(skill);
		counts.set(label, (counts.get(label) ?? 0) + 1);
	}
	return [...counts]
		.sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
		.map(([label, count]) => `${label} ${count}`)
		.join(", ");
}

export interface BudgetedSection {
	text: string;
	unlisted: Skill[];
}

export function budgetedSkillsSection(
	skills: readonly Skill[],
	budgetChars: number,
): BudgetedSection | undefined {
	if (formatSkillsForPrompt([...skills]).trim().length <= budgetChars) return undefined;
	const ranked = rankSkills(skills);
	const shortened = ranked.map((skill) => ({
		...skill,
		description: shorten(skill.description, DESCRIPTION_CHARS),
	}));
	const section = (listed: number) => {
		const unlisted = ranked.slice(listed);
		return [
			formatSkillsForPrompt(shortened.slice(0, listed)).trim(),
			`Only ${listed} of ${ranked.length} skills are listed here. Before starting a task that a specialized skill could cover, call ${SKILL_SEARCH_TOOL} with a few keywords to find unlisted skills, then read the matching file.`,
			...(unlisted.length > 0 ? [`Unlisted skills by source: ${unlistedSummary(unlisted)}.`] : []),
		]
			.filter(Boolean)
			.join("\n");
	};
	let low = 0;
	let high = ranked.length;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (section(mid).length <= budgetChars) low = mid;
		else high = mid - 1;
	}
	return { text: section(low), unlisted: ranked.slice(low) };
}

function tokens(text: string): string[] {
	return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map((token) =>
		token.length > 3 && token.endsWith("s") && !token.endsWith("ss") ? token.slice(0, -1) : token,
	);
}

export interface SkillMatch {
	skill: Skill;
	score: number;
	distinctive: number;
	nameHit: boolean;
}

export function searchSkills(
	skills: readonly Skill[],
	query: string,
	limit = SEARCH_DEFAULT_LIMIT,
): SkillMatch[] {
	const terms = [...new Set(tokens(query))];
	const ranked = rankSkills(skills);
	if (terms.length === 0 || ranked.length === 0) return [];
	const docs = ranked.map((skill) => {
		const nameTokens = tokens(skill.name);
		const all = [...nameTokens, ...nameTokens, ...nameTokens, ...tokens(skill.description)];
		const tf = new Map<string, number>();
		for (const token of all) tf.set(token, (tf.get(token) ?? 0) + 1);
		return { skill, tf, length: all.length, name: skill.name.toLowerCase(), nameTokens };
	});
	const avg = docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length;
	const df = new Map(terms.map((term) => [term, docs.filter((doc) => doc.tf.has(term)).length]));
	const rare = Math.max(1, Math.floor(docs.length * DISTINCTIVE_SHARE));
	const whole = query.trim().toLowerCase();
	return docs
		.map((doc) => {
			let score = doc.name === whole ? 10 : 0;
			let distinctive = 0;
			let nameHit = false;
			for (const term of terms) {
				const freq = doc.tf.get(term) ?? 0;
				if (freq === 0) continue;
				const n = df.get(term) ?? 0;
				const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
				score += (idf * freq * 2.2) / (freq + 1.2 * (0.25 + (0.75 * doc.length) / avg));
				if (n <= rare) {
					distinctive++;
					nameHit ||= doc.nameTokens.includes(term);
				}
			}
			return { skill: doc.skill, score, distinctive, nameHit };
		})
		.filter((match) => match.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(
			0,
			Number.isFinite(limit)
				? Math.max(1, Math.min(SEARCH_MAX_LIMIT, Math.floor(limit)))
				: SEARCH_DEFAULT_LIMIT,
		);
}

export function formatSkillMatches(query: string, matches: readonly SkillMatch[]): string {
	if (matches.length === 0)
		return `No skill matches "${query}". Try other keywords, or continue without a skill.`;
	return [
		`Skills matching "${query}", best first. Read a skill's file with the read tool before following it.`,
		"",
		...matches.map(({ skill }) => skillLine(skill)),
	].join("\n");
}

export function suggestSkills(
	skills: readonly Skill[],
	unlisted: readonly Skill[],
	prompt: string,
	exclude: ReadonlySet<string> = new Set(),
): Skill[] {
	const candidates = new Set(
		unlisted.filter((skill) => !exclude.has(skill.name)).map((skill) => skill.filePath),
	);
	if (candidates.size === 0) return [];
	return searchSkills(skills, prompt, SEARCH_MAX_LIMIT)
		.filter(
			(match) => candidates.has(match.skill.filePath) && (match.nameHit || match.distinctive >= 2),
		)
		.slice(0, HINT_LIMIT)
		.map((match) => match.skill);
}

export function formatSkillHint(skills: readonly Skill[]): string {
	return [
		"Skills not listed in the system prompt that may fit this request. If one matches the task, read its file before starting and follow it:",
		...skills.map(skillLine),
	].join("\n");
}

export function hintedSkills(entries: readonly SessionEntry[]): Set<string> {
	const names = new Set<string>();
	for (const entry of entries) {
		if (entry.type !== "custom_message" || entry.customType !== SKILL_HINT_CUSTOM_TYPE) continue;
		const details = entry.details;
		if (!details || typeof details !== "object" || !("skills" in details)) continue;
		if (!Array.isArray(details.skills)) continue;
		for (const name of details.skills) if (typeof name === "string") names.add(name);
	}
	return names;
}

const searchParams = Type.Object({
	query: Type.String({ description: "Keywords describing the task, e.g. 'pdf form fill'." }),
	limit: Type.Optional(
		Type.Number({
			description: `Maximum results, 1-${SEARCH_MAX_LIMIT}. Default ${SEARCH_DEFAULT_LIMIT}.`,
		}),
	),
});

function createSkillSearchTool(
	getSkills: () => readonly Skill[],
): ToolDefinition<typeof searchParams, { matches: string[] }> {
	return {
		name: SKILL_SEARCH_TOOL,
		label: "Search skills",
		description:
			"Search every available skill by keywords, including skills the system prompt does not list. Returns names, descriptions and SKILL.md locations to read.",
		parameters: searchParams,
		async execute(_toolCallId, input) {
			const matches = searchSkills(getSkills(), input.query, input.limit);
			return {
				content: [{ type: "text", text: formatSkillMatches(input.query, matches) }],
				details: { matches: matches.map(({ skill }) => skill.name) },
			};
		},
	};
}

export function skillCatalog(pi: ExtensionAPI): void {
	let skills: readonly Skill[] = [];
	let memo: { key: string; section: BudgetedSection | undefined } | undefined;
	pi.registerTool(createSkillSearchTool(() => skills));
	pi.on("before_agent_start", (event, ctx) => {
		const options = event.systemPromptOptions;
		skills = options.skills;
		const callable = (tool: string) =>
			options.selectedTools.includes(tool) && !options.hiddenTools.includes(tool);
		if (!callable("read") || !callable(SKILL_SEARCH_TOOL)) return;
		const budget = catalogBudgetChars(ctx.model);
		const key = `${budget}\n${skills.map((skill) => `${skill.filePath}\0${skill.description}`).join("\n")}`;
		if (memo?.key !== key) memo = { key, section: budgetedSkillsSection(skills, budget) };
		const section = memo.section;
		if (!section) return;
		options.sections.skills = section.text;
		if (event.messageType !== "user") return;
		const invoked = parseSkillBlock(event.prompt);
		const request = invoked ? invoked.userMessage : event.prompt;
		if (!request) return;
		const exclude = hintedSkills(ctx.sessionManager.buildContextEntries());
		if (invoked) exclude.add(invoked.name);
		const hint = suggestSkills(skills, section.unlisted, request, exclude);
		if (hint.length === 0) return;
		return {
			message: {
				customType: SKILL_HINT_CUSTOM_TYPE,
				content: formatSkillHint(hint),
				details: { skills: hint.map((skill) => skill.name) },
				display: false,
			},
		};
	});
}
