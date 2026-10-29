import {
	type AppSurvey,
	SURVEY_OPEN_TEXT_LIMIT,
	type SurveyAnswerValue,
	type SurveyChoiceQuestion,
	type SurveyQuestion,
	type SurveyRatingScale,
	surveyRatingValues,
} from "@thinkrail/contracts";

export const IN_APP_SURVEY_NAME = "in-app-feedback";
export const SURVEY_REFRESH_MS = 15 * 60 * 1000;
export const SURVEY_STALE_MS = 60 * 60 * 1000;

const SURVEY_LIST_LIMIT = 1_000_000;
const FETCH_TIMEOUT_MS = 10_000;
const QUESTION_LIMIT = 1_000;
const DESCRIPTION_LIMIT = 2_000;
const CHOICE_LIMIT = 500;
const CHOICE_COUNT_LIMIT = 30;
const DEFAULT_HOST = "https://eu.i.posthog.com";

const RATING_SCALES: readonly SurveyRatingScale[] = [3, 5, 7, 10];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SurveySource {
	apiKey: string;
	host?: string;
	fetchImpl?: typeof fetch;
}

export interface ParsedSurveySubmission {
	submissionId: string;
	surveyId: string;
	iteration: number;
	answers: Record<string, SurveyAnswerValue>;
}

interface ActiveSource {
	apiKey: string;
	host: string;
	fetchImpl: typeof fetch;
}

let source: ActiveSource | null = null;
let cached: AppSurvey | null = null;
let attemptedAt = 0;
let succeededAt = 0;
let generation = 0;
let inFlight: Promise<AppSurvey | null> | null = null;
let clock: () => number = () => Date.now();

export function configureSurveySource(next: SurveySource | null): void {
	generation += 1;
	inFlight = null;
	cached = null;
	attemptedAt = 0;
	succeededAt = 0;
	if (!next?.apiKey) {
		source = null;
		return;
	}
	source = {
		apiKey: next.apiKey,
		host: (next.host ?? DEFAULT_HOST).replace(/\/+$/, ""),
		fetchImpl: next.fetchImpl ?? fetch,
	};
}

export function currentInAppSurvey(): AppSurvey | null {
	return cached;
}

export function surveyRefreshDue(at = clock()): boolean {
	if (!source) return false;
	return attemptedAt === 0 || at - attemptedAt >= SURVEY_REFRESH_MS;
}

export function setSurveyClockForTests(next: (() => number) | null): void {
	clock = next ?? (() => Date.now());
}

export function resetSurveyForTests(): void {
	generation += 1;
	source = null;
	cached = null;
	attemptedAt = 0;
	succeededAt = 0;
	inFlight = null;
	clock = () => Date.now();
}

export function refreshInAppSurvey(): Promise<AppSurvey | null> {
	const active = source;
	if (!active || !surveyRefreshDue()) return Promise.resolve(cached);
	return load(active).catch(() => cached);
}

export function confirmInAppSurvey(): Promise<AppSurvey | null> {
	const active = source;
	if (!active) return Promise.resolve(null);
	return load(active);
}

function load(active: ActiveSource): Promise<AppSurvey | null> {
	if (inFlight) return inFlight;
	const stamp = generation;
	const pending = fetchSurvey(active)
		.then(
			(next) => {
				if (stamp !== generation) throw new Error("survey source changed");
				cached = next;
				attemptedAt = clock();
				succeededAt = attemptedAt;
				return next;
			},
			(error: unknown) => {
				if (stamp === generation) {
					attemptedAt = clock();
					if (attemptedAt - succeededAt >= SURVEY_STALE_MS) cached = null;
				}
				throw error;
			},
		)
		.finally(() => {
			if (inFlight === pending) inFlight = null;
		});
	inFlight = pending;
	return pending;
}

export function selectInAppSurvey(payload: unknown): AppSurvey | null {
	let best: { survey: AppSurvey; started: number } | null = null;
	for (const entry of surveyList(payload)) {
		const selected = selectOne(entry);
		if (!selected) continue;
		if (!best || selected.started >= best.started) best = selected;
	}
	return best?.survey ?? null;
}

export function parseSurveySubmission(value: unknown): ParsedSurveySubmission {
	if (!isRecord(value)) throw new Error("Invalid survey submission");
	const { submissionId, surveyId, iteration } = value;
	if (typeof submissionId !== "string" || !UUID.test(submissionId)) {
		throw new Error("Invalid survey submission");
	}
	if (typeof surveyId !== "string" || !surveyId || surveyId.length > 128) {
		throw new Error("Invalid survey submission");
	}
	if (typeof iteration !== "number" || !Number.isSafeInteger(iteration) || iteration < 0) {
		throw new Error("Invalid survey submission");
	}
	return { submissionId, surveyId, iteration, answers: parseAnswers(value.answers) };
}

export function surveyResponse(
	survey: AppSurvey,
	submission: ParsedSurveySubmission,
): Record<string, unknown> {
	return {
		$survey_id: survey.id,
		$survey_iteration: survey.iteration,
		$survey_submission_id: submission.submissionId,
		$survey_completed: true,
		$survey_questions: survey.questions.map((question) => ({
			id: question.id,
			question: question.question,
		})),
		...resolveResponses(survey, submission.answers),
	};
}

async function fetchSurvey(active: ActiveSource): Promise<AppSurvey | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const response = await active.fetchImpl(
			`${active.host}/api/surveys/?token=${encodeURIComponent(active.apiKey)}`,
			{
				signal: controller.signal,
				redirect: "error",
				headers: { accept: "application/json" },
			},
		);
		if (!response.ok) throw new Error("survey list failed");
		const body = await response.text();
		if (body.length > SURVEY_LIST_LIMIT) throw new Error("survey list too large");
		return selectInAppSurvey(JSON.parse(body) as unknown);
	} finally {
		clearTimeout(timer);
	}
}

function surveyList(payload: unknown): unknown[] {
	if (Array.isArray(payload)) return payload;
	if (!isRecord(payload) || !Array.isArray(payload.surveys)) return [];
	return payload.surveys;
}

function selectOne(entry: unknown): { survey: AppSurvey; started: number } | null {
	if (!isRecord(entry) || entry.name !== IN_APP_SURVEY_NAME) return null;
	if (entry.archived === true || typeof entry.end_date === "string") return null;
	const started = typeof entry.start_date === "string" ? Date.parse(entry.start_date) : Number.NaN;
	if (!Number.isFinite(started)) return null;
	const id = boundedText(entry.id, 128);
	if (!id) return null;
	const questions = Array.isArray(entry.questions)
		? entry.questions.flatMap((question) => {
				const mapped = mapQuestion(question);
				return mapped ? [mapped] : [];
			})
		: [];
	if (questions.length === 0) return null;
	const appearance = isRecord(entry.appearance) ? entry.appearance : {};
	const placeholder = boundedText(appearance.placeholder, 200);
	const showThanks = appearance.displayThankYouMessage !== false;
	const thankYou = plainText(appearance.thankYouMessageHeader, 500) ?? "";
	const survey: AppSurvey = {
		id,
		iteration: iterationOf(entry.current_iteration),
		questions,
		...(placeholder ? { placeholder } : {}),
		...(showThanks ? { thankYou } : {}),
		...(appearance.shuffleQuestions === true ? { shuffleQuestions: true } : {}),
	};
	return { survey, started };
}

function mapQuestion(entry: unknown): SurveyQuestion | null {
	if (!isRecord(entry)) return null;
	const id = boundedText(entry.id, 80);
	const question = plainText(entry.question, QUESTION_LIMIT);
	if (!id || !question) return null;
	const description = plainText(entry.description, DESCRIPTION_LIMIT);
	const base = {
		id,
		question,
		...(description ? { description } : {}),
		...(entry.optional === true ? { optional: true as const } : {}),
	};
	if (entry.type === "open") return { ...base, type: "open" };
	if (entry.type === "single_choice" || entry.type === "multiple_choice") {
		const choices = choiceList(entry.choices);
		if (!choices) return null;
		return {
			...base,
			type: entry.type,
			choices,
			...(entry.hasOpenChoice === true ? { hasOpenChoice: true } : {}),
			...(entry.shuffleOptions === true ? { shuffleOptions: true } : {}),
		};
	}
	if (entry.type === "rating") {
		const scale = ratingScale(entry.scale);
		if (!scale) return null;
		const emoji = entry.display === "emoji" && (scale === 3 || scale === 5);
		return {
			...base,
			type: "rating",
			display: emoji ? "emoji" : "number",
			scale,
			lowerBoundLabel: plainText(entry.lowerBoundLabel, 80) ?? "",
			upperBoundLabel: plainText(entry.upperBoundLabel, 80) ?? "",
		};
	}
	return null;
}

function resolveResponses(
	survey: AppSurvey,
	answers: Record<string, SurveyAnswerValue>,
): Record<string, SurveyAnswerValue> {
	const responses: Record<string, SurveyAnswerValue> = {};
	const questions = new Map(survey.questions.map((question) => [question.id, question]));
	for (const [id, value] of Object.entries(answers)) {
		const question = questions.get(id);
		if (!question) throw new Error("Invalid survey answer");
		responses[`$survey_response_${id}`] = answerFor(question, value);
	}
	for (const question of survey.questions) {
		if (question.optional) continue;
		if (!Object.hasOwn(responses, `$survey_response_${question.id}`)) {
			throw new Error("Invalid survey answer");
		}
	}
	return responses;
}

function answerFor(question: SurveyQuestion, value: SurveyAnswerValue): SurveyAnswerValue {
	if (question.type === "open") {
		if (typeof value !== "string") throw new Error("Invalid survey answer");
		const text = value.trim();
		if (!text || text.length > SURVEY_OPEN_TEXT_LIMIT) throw new Error("Invalid survey answer");
		return text;
	}
	if (question.type === "rating") {
		if (typeof value !== "string") throw new Error("Invalid survey answer");
		if (!surveyRatingValues(question.scale).some((point) => String(point) === value)) {
			throw new Error("Invalid survey answer");
		}
		return value;
	}
	return choiceAnswer(question, value);
}

function choiceAnswer(question: SurveyChoiceQuestion, value: SurveyAnswerValue): SurveyAnswerValue {
	if (question.type === "single_choice") return openOrChoice(question, value);
	if (!Array.isArray(value) || value.length === 0) throw new Error("Invalid survey answer");
	const chosen: string[] = [];
	let opened = false;
	for (const item of value) {
		const text = choiceText(item);
		if (question.choices.includes(text)) {
			if (!chosen.includes(text)) chosen.push(text);
			continue;
		}
		if (!question.hasOpenChoice || opened) throw new Error("Invalid survey answer");
		opened = true;
		chosen.push(text);
	}
	return chosen;
}

function openOrChoice(question: SurveyChoiceQuestion, value: SurveyAnswerValue): string {
	if (typeof value !== "string") throw new Error("Invalid survey answer");
	const text = choiceText(value);
	if (question.choices.includes(text) || question.hasOpenChoice) return text;
	throw new Error("Invalid survey answer");
}

function choiceText(value: unknown): string {
	if (typeof value !== "string") throw new Error("Invalid survey answer");
	const text = value.trim();
	if (!text || text.length > SURVEY_OPEN_TEXT_LIMIT) throw new Error("Invalid survey answer");
	return text;
}

function parseAnswers(value: unknown): Record<string, SurveyAnswerValue> {
	if (value === undefined) return {};
	if (!isRecord(value)) throw new Error("Invalid survey submission");
	const answers: Record<string, SurveyAnswerValue> = {};
	for (const [id, answer] of Object.entries(value)) {
		if (!id || id.length > 80) throw new Error("Invalid survey submission");
		if (typeof answer === "string") {
			answers[id] = answer;
			continue;
		}
		if (!Array.isArray(answer) || answer.some((item) => typeof item !== "string")) {
			throw new Error("Invalid survey submission");
		}
		answers[id] = answer;
	}
	return answers;
}

function choiceList(value: unknown): string[] | null {
	if (!Array.isArray(value) || value.length === 0 || value.length > CHOICE_COUNT_LIMIT) return null;
	const choices: string[] = [];
	for (const entry of value) {
		const choice = plainText(entry, CHOICE_LIMIT);
		if (!choice || choices.includes(choice)) return null;
		choices.push(choice);
	}
	return choices;
}

function ratingScale(value: unknown): SurveyRatingScale | null {
	return RATING_SCALES.some((scale) => scale === value) ? (value as SurveyRatingScale) : null;
}

function iterationOf(value: unknown): number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function plainText(value: unknown, max: number): string | null {
	const raw = boundedText(value, max * 4);
	if (!raw) return null;
	const stripped = raw
		.replace(/<[^>]*>/g, "")
		.replace(/\s+/g, " ")
		.trim();
	return boundedText(stripped, max);
}

function boundedText(value: unknown, max: number): string | null {
	if (typeof value !== "string") return null;
	const text = value.trim();
	if (!text) return null;
	return text.length > max ? text.slice(0, max) : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
