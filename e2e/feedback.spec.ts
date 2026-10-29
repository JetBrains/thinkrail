import { expect, type Page, test, type WebSocketRoute } from "@playwright/test";
import {
	type AppSurvey,
	FEEDBACK_SURVEY_PROTOCOL_VERSION,
	type SurveySubmitParams,
	WS_CHANNELS,
	type WsErrorCode,
} from "@thinkrail/contracts";

const NOTICE_START = "Your answers, including anything you type, are sent to the ThinkRail team";

function survey(iteration: number): AppSurvey {
	return {
		id: "01a17d9c-e8d7-0000-dbbb-79aad51d2281",
		iteration,
		placeholder: "Start typing...",
		thankYou: "Thank you for your feedback!",
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
			{ id: "open", type: "open", question: "What can we do to improve our product?" },
		],
	};
}

type ClientRequest = {
	id?: string;
	method?: string;
	params?: { action?: string } & Partial<SurveySubmitParams>;
};

interface SurveyHost {
	available: AppSurvey | null;
	submits: Partial<SurveySubmitParams>[];
	actions: string[];
	reads: number;
	nextSubmitError: WsErrorCode | null;
	socket: () => WebSocketRoute;
	welcomeFrame: () => string;
}

async function stubSurveyHost(
	page: Page,
	initial: AppSurvey | null,
	protocolVersion?: number,
): Promise<SurveyHost> {
	let browserSocket: WebSocketRoute | undefined;
	let welcome: string | undefined;
	const host: SurveyHost = {
		available: initial,
		submits: [],
		actions: [],
		reads: 0,
		nextSubmitError: null,
		socket: () => {
			if (!browserSocket) throw new Error("expected the app WebSocket");
			return browserSocket;
		},
		welcomeFrame: () => {
			if (!welcome) throw new Error("expected the host welcome frame");
			return welcome;
		},
	};
	await page.routeWebSocket(/\/ws(\?|$)/, (socket) => {
		browserSocket = socket;
		const server = socket.connectToServer();
		socket.onMessage((message) => {
			const raw = typeof message === "string" ? message : message.toString();
			let request: ClientRequest;
			try {
				request = JSON.parse(raw) as ClientRequest;
			} catch {
				server.send(message);
				return;
			}
			if (request.method === "feedback.survey" && request.id) {
				host.reads += 1;
				socket.send(
					JSON.stringify({ id: request.id, ok: true, result: { survey: host.available } }),
				);
				return;
			}
			if (request.method === "feedback.survey.submit" && request.id) {
				host.submits.push(request.params ?? {});
				const errorCode = host.nextSubmitError;
				if (errorCode) {
					host.nextSubmitError = null;
					socket.send(JSON.stringify({ id: request.id, ok: false, error: errorCode, errorCode }));
					return;
				}
				host.available = null;
				socket.send(JSON.stringify({ id: request.id, ok: true, result: { ok: true } }));
				return;
			}
			if (request.method === "feedback.respond" && request.id) {
				host.actions.push(request.params?.action ?? "");
				socket.send(JSON.stringify({ id: request.id, ok: true, result: { ok: true } }));
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => {
			const raw = typeof message === "string" ? message : message.toString();
			try {
				const frame = JSON.parse(raw) as { channel?: string; data?: { protocolVersion?: number } };
				if (frame.channel === WS_CHANNELS.serverWelcome) {
					if (protocolVersion !== undefined && frame.data) {
						frame.data.protocolVersion = protocolVersion;
						welcome = JSON.stringify(frame);
						socket.send(welcome);
						return;
					}
					welcome = raw;
				}
			} catch {}
			socket.send(message);
		});
	});
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	return host;
}

function invite(host: SurveyHost): void {
	host.socket().send(JSON.stringify({ channel: WS_CHANNELS.feedbackInterview, data: {} }));
}

async function answer(page: Page): Promise<void> {
	const window = page.getByTestId("survey-window");
	await window.getByTestId("survey-rating").locator("label", { hasText: /^4$/ }).click();
	await window.getByTestId("survey-continue").click();
	await expect(window.getByTestId("survey-notice")).toHaveCount(0);
	await window.getByRole("textbox").fill("Clearer diffs");
}

test("the invitation and Settings open one survey window, and only Send sends", async ({
	page,
}) => {
	const host = await stubSurveyHost(page, survey(1));
	const window = page.getByTestId("survey-window");
	const invitation = page.getByTestId("survey-invitation-dialog");

	await page.getByTestId("open-settings").click();
	const nav = page.getByTestId("settings-nav-feedback");
	await expect(nav).toHaveText("Share feedback");
	await expect(nav).toHaveClass(/md:mt-auto/);
	await nav.click();
	const pane = page.getByTestId("settings-feedback");
	await expect(pane.getByTestId("feedback-join-discord")).toHaveAttribute(
		"href",
		"https://thinkrail.ai/discord",
	);
	await expect(pane.getByTestId("feedback-email").getByRole("link")).toHaveAttribute(
		"href",
		"mailto:info@thinkrail.ai",
	);
	await expect(pane.getByTestId("survey-question")).toHaveCount(0);
	await pane.getByTestId("feedback-take-survey").click();
	await expect(page.getByTestId("settings-dialog")).toBeHidden();
	await expect(window).toBeVisible();
	await expect(window.getByTestId("survey-notice")).toContainText(NOTICE_START);
	await expect(window.getByTestId("survey-notice").getByRole("link")).toHaveCount(0);
	await expect(window.getByTestId("survey-question")).toHaveText(
		"How likely are you to recommend ThinkRail?",
	);
	await expect(window.getByTestId("survey-continue")).toBeDisabled();
	await answer(page);
	await page.keyboard.press("Escape");
	await expect(window).toBeHidden();
	expect(host.submits).toEqual([]);
	expect(host.actions).toEqual([]);

	invite(host);
	await expect(invitation).toBeVisible();
	await expect(invitation).toContainText("Would you spend 5 minutes");
	await invitation.getByTestId("survey-invitation-postpone").click();
	await expect(invitation).toBeHidden();
	await expect.poll(() => host.actions).toEqual(["postpone"]);

	invite(host);
	await invitation.getByTestId("survey-invitation-take").click();
	await expect(invitation).toBeHidden();
	await expect(window).toBeVisible();
	await expect.poll(() => host.actions).toEqual(["postpone", "postpone"]);
	await expect(window.getByTestId("survey-notice")).toBeVisible();
	await answer(page);
	await window.getByTestId("survey-send").click();
	await expect(window.getByTestId("survey-thanks")).toHaveText("Thank you for your feedback!");
	expect(host.submits).toHaveLength(1);
	expect(host.submits[0]).toMatchObject({
		surveyId: "01a17d9c-e8d7-0000-dbbb-79aad51d2281",
		iteration: 1,
		answers: { rate: "4", open: "Clearer diffs" },
	});
	expect(host.submits[0]?.submissionId).toMatch(/^[0-9a-f-]{36}$/);
	await window.getByRole("button", { name: "Close" }).first().click();
	await expect(window).toBeHidden();

	const reads = host.reads;
	await page.getByTestId("open-settings").click();
	await expect.poll(() => host.reads).toBeGreaterThan(reads);
	await page.getByTestId("settings-nav-feedback").click();
	await expect(pane.getByTestId("feedback-take-survey")).toHaveCount(0);
	await expect(pane.getByTestId("feedback-join-discord")).toBeVisible();
	await page.keyboard.press("Escape");

	invite(host);
	await invitation.getByTestId("survey-invitation-never").click();
	await expect(invitation).toBeHidden();
	await expect.poll(() => host.actions.at(-1)).toBe("never");

	invite(host);
	await expect(invitation).toBeVisible();
	host.socket().send(host.welcomeFrame());
	await expect(invitation).toBeHidden();
	expect(host.actions.at(-1)).toBe("never");
});

test("a survey changed in PostHog restarts on the new version before anything is recorded", async ({
	page,
}) => {
	const host = await stubSurveyHost(page, survey(1));
	const window = page.getByTestId("survey-window");
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-feedback").click();
	await page.getByTestId("feedback-take-survey").click();
	await answer(page);

	host.nextSubmitError = "SURVEY_CHANGED";
	host.available = survey(2);
	await window.getByTestId("survey-send").click();
	await expect(window.getByTestId("survey-changed")).toBeVisible();
	await expect(window.getByTestId("survey-notice")).toBeVisible();
	await expect(window.getByTestId("survey-question")).toHaveText(
		"How likely are you to recommend ThinkRail?",
	);
	await answer(page);
	await window.getByTestId("survey-send").click();
	await expect(window.getByTestId("survey-thanks")).toBeVisible();
	expect(host.submits.map((submit) => submit.iteration)).toEqual([1, 2]);
});

test("an unsent survey stays open with an inline error and can be sent again", async ({ page }) => {
	const host = await stubSurveyHost(page, survey(1));
	const window = page.getByTestId("survey-window");
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-feedback").click();
	await page.getByTestId("feedback-take-survey").click();
	await answer(page);

	host.nextSubmitError = "SURVEY_NOT_SENT";
	await window.getByTestId("survey-send").click();
	await expect(window.getByRole("alert")).toHaveText(
		"Couldn't send your answers. Please try again.",
	);
	await expect(window.getByTestId("survey-send")).toBeEnabled();
	await window.getByTestId("survey-send").click();
	await expect(window.getByTestId("survey-thanks")).toBeVisible();
	expect(host.submits).toHaveLength(2);
});

test("with no survey launched the Feedback pane keeps Discord and email only", async ({ page }) => {
	await stubSurveyHost(page, null);
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-feedback").click();
	const pane = page.getByTestId("settings-feedback");
	await expect(pane.getByTestId("feedback-join-discord")).toBeVisible();
	await expect(pane.getByTestId("feedback-email")).toContainText("info@thinkrail.ai");
	await expect(pane.getByTestId("feedback-take-survey")).toHaveCount(0);
});

test("a long question scrolls inside the survey window so every control stays reachable", async ({
	page,
}) => {
	await page.setViewportSize({ width: 800, height: 480 });
	const choices = Array.from({ length: 30 }, (_, index) => `Option ${index + 1}`);
	await stubSurveyHost(page, {
		...survey(1),
		questions: [{ id: "many", type: "multiple_choice", question: "Which apply?", choices }],
	});
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-feedback").click();
	await page.getByTestId("feedback-take-survey").click();
	const window = page.getByTestId("survey-window");
	const box = await window.boundingBox();
	expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
	expect((box?.y ?? 0) + (box?.height ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(480);
	await expect(window.getByRole("button", { name: "Close" })).toBeInViewport();
	await expect(window.getByText("Option 1", { exact: true })).toBeInViewport();
	await window.getByText("Option 30", { exact: true }).click();
	await window.getByTestId("survey-send").scrollIntoViewIfNeeded();
	await expect(window.getByTestId("survey-send")).toBeInViewport();
	await expect(window.getByRole("button", { name: "Close" })).toBeInViewport();
});

test("a pre-v97 host's retired interview invitation never opens the survey invitation", async ({
	page,
}) => {
	const host = await stubSurveyHost(page, survey(1), FEEDBACK_SURVEY_PROTOCOL_VERSION - 1);
	invite(host);
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-feedback").click();
	await expect(page.getByTestId("feedback-join-discord")).toBeVisible();
	await expect(page.getByTestId("feedback-take-survey")).toHaveCount(0);
	await expect(page.getByTestId("survey-invitation-dialog")).toHaveCount(0);
	expect(host.reads).toBe(0);
});
