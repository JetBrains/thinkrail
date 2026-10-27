import type {
	WebsiteSurveyDismissedProperties,
	WebsiteSurveySentProperties,
	WebsiteSurveyShownProperties,
} from "@thinkrail/website-analytics";

export const downloadPostHogSurveyId = "01a17ce8-aae4-0000-f8c2-74cf8eb20b72";
export const downloadSurveyFreeTextLimit = 500;
export const downloadSurveyCompletionKey = "thinkrail_download_survey_completed";

export type SurveyCompletionStorage = Pick<Storage, "getItem" | "setItem">;

export type SurveyChoice = {
	id: string;
	label: string;
	custom?: boolean;
};

export type SurveyStep = {
	index: number;
	questionId: string;
	prompt: string;
	kind: "multi" | "text";
	required: boolean;
	max?: number;
	columns?: boolean;
	hint?: string;
	email?: true;
	placeholder?: string;
	action: "Continue" | "Finish";
	choices: readonly SurveyChoice[];
};

export type SurveyPlace = Omit<WebsiteSurveyShownProperties, "$survey_id">;

export type SurveyResponse = {
	readonly id: string;
	readonly order: readonly (readonly SurveyChoice[])[];
	readonly answers: Readonly<Record<string, string | string[]>>;
	readonly sent: boolean;
};

const other: SurveyChoice = { id: "other", label: "Something else", custom: true };
const otherTool: SurveyChoice = { id: "other", label: "Other", custom: true };

export const downloadSurveySteps: readonly SurveyStep[] = [
	{
		index: 1,
		questionId: "3060825b-fbc8-4a3a-b0d5-4585076084b1",
		prompt: "What makes ThinkRail interesting to you?",
		kind: "multi",
		required: true,
		hint: "Choose all that apply",
		action: "Continue",
		choices: [
			{ id: "pi_gui", label: "Graphical interface for Pi" },
			{ id: "agents_one_place", label: "Managing agents one place" },
			{ id: "reviewing_changes", label: "Reviewing changes" },
			{ id: "spec_driven", label: "Spec-driven development" },
			{ id: "trying_tools", label: "Trying new tools" },
			other,
		],
	},
	{
		index: 2,
		questionId: "503da915-a4e0-4176-8463-45dddc59ce8c",
		prompt: "Which best describes your current experience? (choose all that apply)",
		kind: "multi",
		required: true,
		action: "Continue",
		choices: [
			{ id: "codes_self", label: "I code myself" },
			{ id: "ai_chats", label: "I use AI suggestions and chats" },
			{ id: "delegates_agents", label: "I delegate coding to agents" },
			{ id: "not_coding", label: "I'm not currently coding" },
		],
	},
	{
		index: 3,
		questionId: "729dae02-f8c3-4b94-aff7-f6606ffb5dd0",
		prompt: "Which coding tools have you used most in the past month?",
		kind: "multi",
		required: true,
		columns: true,
		hint: "Choose all that apply",
		action: "Continue",
		choices: [
			{ id: "cursor", label: "Cursor" },
			{ id: "claude_code", label: "Claude Code" },
			{ id: "codex", label: "Codex" },
			{ id: "pi", label: "Pi / oh-my-pi" },
			{ id: "jetbrains", label: "JetBrains IDEs" },
			{ id: "vscode", label: "VS Code" },
			{ id: "zed", label: "Zed / Delta" },
			{ id: "orca", label: "Orca" },
			{ id: "t3_code", label: "T3 Code" },
			{ id: "copilot", label: "Github Copilot" },
			otherTool,
		],
	},
	{
		index: 4,
		questionId: "09e9d3f2-4c3e-4293-b1a1-31f66c20a4cf",
		prompt: "What are you most dissatisfied with in your current setup? (up to three)",
		kind: "multi",
		required: true,
		max: 3,
		action: "Continue",
		choices: [
			{ id: "reviewing_ai", label: "Understanding and reviewing AI changes" },
			{ id: "follow_requirements", label: "Getting agents to follow my requirements" },
			{ id: "repeat_context", label: "Having to explain project context repeatedly" },
			{ id: "multiple_tasks", label: "Keeping track of multiple tasks or projects" },
			{ id: "switching_tools", label: "Switching between tools" },
			{
				id: "models_subscriptions",
				label: "Connecting the models or subscriptions I want to use",
			},
			{ id: "cost", label: "The cost of AI usage" },
			{ id: "slow_tools", label: "Slow or unresponsive tools" },
			other,
		],
	},
	{
		index: 5,
		questionId: "26a0ff6b-e15b-407e-a0e7-c210e3df5d3e",
		prompt: "What’s the first thing you’d like to try doing with ThinkRail? (optional)",
		kind: "text",
		required: false,
		placeholder: "Optional — a few words is enough",
		action: "Continue",
		choices: [],
	},
	{
		index: 6,
		questionId: "16dcbcb1-bb82-4029-b572-42dc3f192378",
		prompt:
			"If you don't mind us contacting you with product updates or further feedback questions, please enter your email",
		kind: "text",
		required: false,
		email: true,
		placeholder: "Email address",
		action: "Finish",
		choices: [],
	},
];

export function orderedChoices(step: SurveyStep, random: () => number): SurveyChoice[] {
	const fixed = step.choices.filter((choice) => choice.custom === true);
	const shuffled = step.choices.filter((choice) => choice.custom !== true);
	for (let index = shuffled.length - 1; index > 0; index--) {
		const swap = Math.floor(random() * (index + 1));
		const current = shuffled[index];
		const next = shuffled[swap];
		if (current === undefined || next === undefined) continue;
		shuffled[index] = next;
		shuffled[swap] = current;
	}
	return [...shuffled, ...fixed];
}

export function stepCanContinue(
	step: SurveyStep,
	selected: readonly string[],
	freeText: string,
): boolean {
	if (step.kind === "text") return true;
	const known = new Set(step.choices.map((choice) => choice.id));
	const answers = selected.filter((id) => known.has(id));
	if (step.max !== undefined && answers.length > step.max) return false;
	const customSelected = answers.some(
		(id) => step.choices.find((choice) => choice.id === id)?.custom === true,
	);
	if (customSelected && freeText.trim() === "") return false;
	if (step.required && answers.length === 0) return false;
	return true;
}

export function surveyQuestions(): WebsiteSurveySentProperties["$survey_questions"] {
	return downloadSurveySteps.map((step) => ({ id: step.questionId, question: step.prompt }));
}

export function surveyAnswerValue(
	step: SurveyStep,
	selected: readonly string[],
	freeText: string,
): string | string[] | undefined {
	const text = freeText.trim().slice(0, downloadSurveyFreeTextLimit);
	if (step.kind === "text") return text === "" ? undefined : text;
	const answers = selected.flatMap((id) => {
		const choice = step.choices.find((candidate) => candidate.id === id);
		if (choice === undefined) return [];
		if (choice.custom === true) return text === "" ? [] : [text];
		return [choice.label];
	});
	return answers;
}

export function surveySentProperties(input: {
	submissionId: string;
	contentKey: string;
	ctaLocation?: WebsiteSurveySentProperties["cta_location"];
	answers: Readonly<Record<string, string | string[]>>;
	completed: boolean;
}): WebsiteSurveySentProperties {
	const responses: Record<`$survey_response_${string}`, string | string[]> = {};
	for (const [questionId, value] of Object.entries(input.answers)) {
		responses[`$survey_response_${questionId}`] = value;
	}
	return {
		$survey_id: downloadPostHogSurveyId,
		$survey_submission_id: input.submissionId,
		$survey_completed: input.completed,
		$survey_questions: surveyQuestions(),
		content_key: input.contentKey,
		...(input.ctaLocation === undefined ? {} : { cta_location: input.ctaLocation }),
		...responses,
	};
}

export function surveyCompletedBefore(storage: SurveyCompletionStorage | undefined): boolean {
	try {
		return storage?.getItem(downloadSurveyCompletionKey) === downloadPostHogSurveyId;
	} catch {
		return false;
	}
}

export function rememberSurveyCompleted(storage: SurveyCompletionStorage | undefined): void {
	try {
		storage?.setItem(downloadSurveyCompletionKey, downloadPostHogSurveyId);
	} catch {}
}

export function startSurveyResponse(id: string, random: () => number): SurveyResponse {
	return {
		id,
		order: downloadSurveySteps.map((step) => orderedChoices(step, random)),
		answers: {},
		sent: false,
	};
}

export function surveyShownProperties(place: SurveyPlace): WebsiteSurveyShownProperties {
	return { $survey_id: downloadPostHogSurveyId, ...place };
}

export function surveyDismissedProperties(
	response: SurveyResponse,
	place: SurveyPlace,
): WebsiteSurveyDismissedProperties | undefined {
	return response.sent ? undefined : { $survey_id: downloadPostHogSurveyId, ...place };
}

export function answerSurveyStep(
	response: SurveyResponse,
	step: SurveyStep,
	selected: readonly string[],
	freeText: string,
	place: SurveyPlace,
): { response: SurveyResponse; properties: WebsiteSurveySentProperties } | undefined {
	if (!stepCanContinue(step, selected, freeText)) return undefined;
	const value = surveyAnswerValue(step, selected, freeText);
	const answers = { ...response.answers };
	if (value === undefined) delete answers[step.questionId];
	else answers[step.questionId] = value;
	return {
		response: { ...response, answers, sent: true },
		properties: surveySentProperties({
			submissionId: response.id,
			contentKey: place.content_key,
			ctaLocation: place.cta_location,
			answers,
			completed: step.index === downloadSurveySteps.length,
		}),
	};
}
