import { expect, test } from "bun:test";
import type { AppSurvey } from "@thinkrail/contracts";
import { EN } from "@thinkrail/locales";
import { renderToStaticMarkup } from "react-dom/server";
import { FeedbackSettingsView } from "./FeedbackSettings";

const SURVEY: AppSurvey = {
	id: "survey-1",
	iteration: 1,
	placeholder: "Start typing...",
	questions: [
		{
			id: "q1",
			type: "open",
			question: "What can we do to improve our product?",
			description: "Test",
		},
	],
};

test("without a launched survey the pane drops Discord and the interview link", () => {
	const markup = renderToStaticMarkup(
		<FeedbackSettingsView survey={null} analyticsEnabled={false} />,
	);
	expect(markup).not.toContain("feedback-join-discord");
	expect(markup).not.toContain("thinkrail.ai/discord");
	expect(markup).not.toContain("calendar.app.google");
	expect(markup).not.toContain(String(EN["panels.survey.analyticsRequired"]));
});

test("analytics off explains how to take the survey", () => {
	const markup = renderToStaticMarkup(
		<FeedbackSettingsView survey={SURVEY} analyticsEnabled={false} />,
	);
	expect(markup).toContain("Please enable analytics to take the survey.");
	expect(markup).toContain("switch it off again later.");
	expect(markup).toContain('data-testid="survey-enable-analytics"');
	expect(markup).toContain(String(EN["panels.survey.enableAnalytics"]));
	expect(markup).not.toContain("What can we do to improve our product?");
});

test("analytics on draws the current question", () => {
	const markup = renderToStaticMarkup(
		<FeedbackSettingsView survey={SURVEY} analyticsEnabled={true} />,
	);
	expect(markup).toContain("What can we do to improve our product?");
	expect(markup).toContain("Test");
	expect(markup).toContain(
		String(EN["panels.survey.progress"]).replace("{{current}}", "1").replace("{{total}}", "1"),
	);
	expect(markup).toContain(String(EN["panels.survey.continue"]));
	expect(markup).not.toContain("feedback-join-discord");
});
