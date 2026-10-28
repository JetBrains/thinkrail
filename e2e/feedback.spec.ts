import { expect, test, type WebSocketRoute } from "@playwright/test";
import { type AppSurvey, WS_CHANNELS } from "@thinkrail/contracts";

const SURVEY: AppSurvey = {
	id: "01a17d9c-e8d7-0000-dbbb-79aad51d2281",
	iteration: 1,
	placeholder: "Start typing...",
	thankYou: "Thank you for your feedback!",
	questions: [
		{
			id: "98283ced-ad26-4913-ab32-ab56441ff1ed",
			type: "open",
			question: "What can we do to improve our product?",
			description: "Test",
		},
	],
};

type SurveySubmit = {
	event?: string;
	completed?: boolean;
	answers?: Record<string, string | string[]>;
};

type ClientRequest = {
	id?: string;
	method?: string;
	params?: { action?: string } & SurveySubmit;
};

test("the settings survey and the usage notification share one survey", async ({ page }) => {
	let browserSocket: WebSocketRoute | undefined;
	let welcomeFrame: string | undefined;
	let rejectNextResponse = false;
	const actions: string[] = [];
	const submits: SurveySubmit[] = [];
	let available: AppSurvey | null = SURVEY;
	let surveyReads = 0;

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
				surveyReads += 1;
				socket.send(JSON.stringify({ id: request.id, ok: true, result: { survey: available } }));
				return;
			}
			if (request.method === "feedback.survey.submit" && request.id) {
				submits.push({
					event: request.params?.event,
					completed: request.params?.completed,
					answers: request.params?.answers,
				});
				if (request.params?.completed === true) available = null;
				socket.send(JSON.stringify({ id: request.id, ok: true, result: { ok: true } }));
				return;
			}
			if (request.method === "feedback.respond" && request.id) {
				actions.push(request.params?.action ?? "");
				if (rejectNextResponse) {
					rejectNextResponse = false;
					socket.send(
						JSON.stringify({ id: request.id, ok: false, error: "feedback response failed" }),
					);
					return;
				}
			}
			server.send(message);
		});
		server.onMessage((message) => {
			const raw = typeof message === "string" ? message : message.toString();
			try {
				const frame = JSON.parse(raw) as { channel?: string };
				if (frame.channel === WS_CHANNELS.serverWelcome) welcomeFrame = raw;
			} catch {}
			socket.send(message);
		});
	});

	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	const sendInvitation = () => {
		if (!browserSocket) throw new Error("expected the app WebSocket");
		browserSocket.send(JSON.stringify({ channel: WS_CHANNELS.feedbackInterview, data: {} }));
	};

	await page.getByTestId("open-settings").click();
	const nav = page.getByTestId("settings-nav-feedback");
	await expect(nav).toBeVisible();
	await expect(nav).toHaveClass(/md:mt-auto/);
	await expect(nav).toHaveText("Share feedback");
	await nav.click();
	const settings = page.getByTestId("settings-feedback");
	await expect(settings.getByTestId("survey-analytics-message")).toContainText(
		"Please enable analytics to take the survey.",
	);
	await expect(settings.getByTestId("feedback-join-discord")).toHaveCount(0);
	await expect(settings.getByTestId("survey-question")).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();

	const suggestion = page.locator('[data-toast="survey-suggestion"]');
	const dialog = page.getByTestId("survey-prompt-dialog");

	sendInvitation();
	await expect(suggestion).toBeVisible();
	await expect(suggestion).toContainText("Great news");
	await expect(suggestion.getByRole("button", { name: "Sure!" })).toBeVisible();
	await expect(suggestion.getByRole("button", { name: "Hide and don't ask again" })).toBeVisible();
	await expect(dialog).toBeHidden();

	await suggestion.getByRole("button", { name: "Sure!" }).click();
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId("survey-analytics-message")).toBeVisible();
	await expect(dialog.getByTestId("survey-question")).toHaveCount(0);
	await dialog.getByTestId("survey-enable-analytics").click();
	await expect(dialog.getByTestId("survey-question")).toHaveText(
		"What can we do to improve our product?",
	);
	await expect.poll(() => submits.some((submit) => submit.event === "shown")).toBe(true);
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect.poll(() => actions.at(-1)).toBe("postpone");
	expect(submits.some((submit) => submit.event === "dismissed")).toBe(true);

	sendInvitation();
	await expect(suggestion).toBeVisible();
	rejectNextResponse = true;
	await suggestion.getByRole("button", { name: "Hide and don't ask again" }).click();
	await expect(suggestion).toContainText("Great news");
	await expect(page.locator('[data-testid="toast"][data-variant="error"]')).toBeVisible();
	await suggestion.getByRole("button", { name: "Hide and don't ask again" }).click();
	await expect(suggestion).toContainText("find it in Settings");
	await expect.poll(() => actions.at(-1)).toBe("never");
	const responses = actions.length;
	await suggestion.getByRole("button", { name: "OK" }).click();
	await expect(suggestion).toBeHidden();
	expect(actions).toHaveLength(responses);

	sendInvitation();
	await expect(suggestion).toBeVisible();
	if (!welcomeFrame) throw new Error("expected the host welcome frame");
	browserSocket?.send(welcomeFrame);
	await expect(suggestion).toBeHidden();
	expect(actions).toHaveLength(responses);

	sendInvitation();
	await expect(suggestion).toBeVisible();
	await suggestion.getByRole("button", { name: "Sure!" }).click();
	await expect(dialog).toBeVisible();
	const enable = dialog.getByTestId("survey-enable-analytics");
	if ((await enable.count()) > 0) await enable.click();
	await expect(dialog.getByTestId("survey-question")).toBeVisible();
	await dialog.getByRole("textbox").fill("Clearer diffs");
	await dialog.getByTestId("survey-continue").click();
	await expect(dialog.getByTestId("survey-thanks")).toHaveText("Thank you for your feedback!");
	await expect
		.poll(() => submits.some((submit) => submit.event === "sent" && submit.completed === true))
		.toBe(true);
	const afterFinish = actions.length;
	await dialog.getByRole("button", { name: "Close" }).click();
	await expect(dialog).toBeHidden();
	expect(actions).toHaveLength(afterFinish);
	const reads = surveyReads;
	await page.getByTestId("open-settings").click();
	await expect.poll(() => surveyReads).toBeGreaterThan(reads);
	await expect(page.getByTestId("settings-nav-feedback")).toHaveCount(0);
});

test("a --no-analytics run explains that the survey cannot save responses", async ({ page }) => {
	const blockedCopy =
		"ThinkRail is running with --no-analytics flag, so the survey can't save responses.";
	let browserSocket: WebSocketRoute | undefined;
	const submits: SurveySubmit[] = [];

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
				socket.send(
					JSON.stringify({
						id: request.id,
						ok: true,
						result: { survey: SURVEY, analyticsSuppressed: true },
					}),
				);
				return;
			}
			if (request.method === "feedback.survey.submit" && request.id) {
				submits.push({ event: request.params?.event });
				socket.send(JSON.stringify({ id: request.id, ok: true, result: { ok: true } }));
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => socket.send(message));
	});

	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-feedback").click();
	const settings = page.getByTestId("settings-feedback");
	await expect(settings.getByTestId("survey-analytics-suppressed")).toContainText(blockedCopy);
	await expect(settings.getByTestId("survey-enable-analytics")).toHaveCount(0);
	await expect(settings.getByTestId("survey-question")).toHaveCount(0);
	await page.keyboard.press("Escape");

	if (!browserSocket) throw new Error("expected the app WebSocket");
	browserSocket.send(JSON.stringify({ channel: WS_CHANNELS.feedbackInterview, data: {} }));
	const suggestion = page.locator('[data-toast="survey-suggestion"]');
	await expect(suggestion).toBeVisible();
	await suggestion.getByRole("button", { name: "Sure!" }).click();
	const dialog = page.getByTestId("survey-prompt-dialog");
	await expect(dialog.getByTestId("survey-analytics-suppressed")).toContainText(blockedCopy);
	await expect(dialog.getByTestId("survey-enable-analytics")).toHaveCount(0);
	await expect(dialog.getByTestId("survey-question")).toHaveCount(0);
	expect(submits).toEqual([]);
});

test("closing still postpones when the survey dismissal is rejected", async ({ page }) => {
	let browserSocket: WebSocketRoute | undefined;
	const actions: string[] = [];
	const submits: SurveySubmit[] = [];

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
				socket.send(JSON.stringify({ id: request.id, ok: true, result: { survey: SURVEY } }));
				return;
			}
			if (request.method === "feedback.survey.submit" && request.id) {
				submits.push({ event: request.params?.event });
				socket.send(JSON.stringify({ id: request.id, ok: false, error: "Survey is unavailable" }));
				return;
			}
			if (request.method === "feedback.respond" && request.id) {
				actions.push(request.params?.action ?? "");
			}
			server.send(message);
		});
		server.onMessage((message) => socket.send(message));
	});

	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("open-settings").click();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();
	if (!browserSocket) throw new Error("expected the app WebSocket");
	browserSocket.send(JSON.stringify({ channel: WS_CHANNELS.feedbackInterview, data: {} }));
	const suggestion = page.locator('[data-toast="survey-suggestion"]');
	await expect(suggestion).toBeVisible();
	await suggestion.getByRole("button", { name: "Sure!" }).click();
	const dialog = page.getByTestId("survey-prompt-dialog");
	await expect(dialog).toBeVisible();
	const enable = dialog.getByTestId("survey-enable-analytics");
	if ((await enable.count()) > 0) await enable.click();
	await expect(dialog.getByTestId("survey-question")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect.poll(() => actions.at(-1)).toBe("postpone");
	expect(submits.some((submit) => submit.event === "dismissed")).toBe(true);
	await expect(page.locator('[data-testid="toast"][data-variant="error"]')).toHaveCount(0);
});
