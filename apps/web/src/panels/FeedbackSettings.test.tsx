import { expect, test } from "bun:test";
import type { AppSurvey } from "@thinkrail/contracts";
import { EN } from "@thinkrail/locales";
import { renderToStaticMarkup } from "react-dom/server";
import { FeedbackSettingsView } from "./FeedbackSettings";
import { SurveyForm } from "./SurveyForm";

const SURVEY: AppSurvey = {
	id: "survey-1",
	iteration: 1,
	placeholder: "Start typing...",
	questions: [
		{
			id: "rate",
			type: "rating",
			question: "How likely are you to recommend ThinkRail?",
			display: "number",
			scale: 5,
			lowerBoundLabel: "Unlikely",
			upperBoundLabel: "Very likely",
		},
		{ id: "open", type: "open", question: "What can we do better?" },
	],
};

function escaped(key: keyof typeof EN): string {
	return String(EN[key]).replaceAll("'", "&#x27;");
}

test("the Feedback pane always offers Discord and email, and the survey only when one is launched", () => {
	const without = renderToStaticMarkup(<FeedbackSettingsView surveyAvailable={false} />);
	expect(without).toContain('data-testid="feedback-join-discord"');
	expect(without).toContain("https://thinkrail.ai/discord");
	expect(without).toContain('href="mailto:info@thinkrail.ai"');
	expect(without).not.toContain('data-testid="feedback-take-survey"');

	const withSurvey = renderToStaticMarkup(<FeedbackSettingsView surveyAvailable={true} />);
	expect(withSurvey).toContain('data-testid="feedback-take-survey"');
	expect(withSurvey).toContain(String(EN["settings.feedback.takeSurvey"]));
	expect(withSurvey).toContain('data-testid="feedback-join-discord"');
	expect(withSurvey).not.toContain("How likely are you to recommend ThinkRail?");
});

test("the survey's first page carries the notice above the first question", () => {
	const markup = renderToStaticMarkup(
		<SurveyForm survey={SURVEY} hostProtocol={98} onSent={() => {}} onChanged={() => {}} />,
	);
	expect(markup).toContain('data-testid="survey-notice"');
	expect(markup).toContain(escaped("panels.survey.notice"));
	expect(markup).not.toContain("<a ");
	expect(markup).toContain("How likely are you to recommend ThinkRail?");
	expect(markup).toContain(
		String(EN["panels.survey.progress"]).replace("{{current}}", "1").replace("{{total}}", "2"),
	);
	expect(markup).toContain('data-testid="survey-continue"');
	expect(markup).not.toContain('data-testid="survey-send"');
});

test("rating points are radio inputs, not buttons", () => {
	const markup = renderToStaticMarkup(
		<SurveyForm survey={SURVEY} hostProtocol={98} onSent={() => {}} onChanged={() => {}} />,
	);
	expect(markup.match(/type="radio"/g)).toHaveLength(5);
	expect(markup).toContain('role="radiogroup"');
	expect(markup).not.toContain("aria-pressed");
	expect(markup).toContain("Unlikely");
});

test("a one-question survey ends on Send", () => {
	const markup = renderToStaticMarkup(
		<SurveyForm
			survey={{ ...SURVEY, questions: [{ id: "open", type: "open", question: "Anything else?" }] }}
			hostProtocol={98}
			onSent={() => {}}
			onChanged={() => {}}
		/>,
	);
	expect(markup).toContain('data-testid="survey-send"');
	expect(markup).toContain(String(EN["panels.survey.send"]));
	expect(markup).toContain('placeholder="Start typing..."');
});

test("Send stays disabled while no host is welcomed, so nothing is queued in the wrong shape", () => {
	const only: AppSurvey = {
		...SURVEY,
		questions: [{ id: "open", type: "open", question: "Anything else?", optional: true }],
	};
	const render = (hostProtocol: number | null) =>
		renderToStaticMarkup(
			<SurveyForm
				survey={only}
				hostProtocol={hostProtocol}
				onSent={() => {}}
				onChanged={() => {}}
			/>,
		);
	expect(render(null)).toMatch(/<button[^>]*data-testid="survey-send"[^>]*disabled=""/);
	expect(render(98)).not.toMatch(/<button[^>]*data-testid="survey-send"[^>]*disabled=""/);
});
