import { expect, test, type WebSocketRoute } from "@playwright/test";
import { WS_CHANNELS } from "@thinkrail/contracts";

const BOOKING_URL = "https://calendar.app.google/5suMJdDEBFvYJ4zN9";
const INVITATION_COPY =
	"Join us for a user interview, tell us about your experience with ThinkRail, and receive 100 bonus credits in Central (JetBrains AI).";

type ClientRequest = {
	id?: string;
	method?: string;
	params?: { action?: string };
};

function sendInvitation(socket: WebSocketRoute | undefined): void {
	if (!socket) throw new Error("expected the app WebSocket");
	socket.send(JSON.stringify({ channel: WS_CHANNELS.feedbackInterview, data: {} }));
}

test("feedback settings and the addressed interview prompt preserve the approved lifecycle", async ({
	context,
	page,
}) => {
	let browserSocket: WebSocketRoute | undefined;
	let welcomeFrame: string | undefined;
	let rejectNextResponse = false;
	const actions: string[] = [];

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
	await context.route("https://calendar.app.google/**", (route) => route.abort());

	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-feedback").click();
	const settings = page.getByTestId("settings-feedback");
	await expect(settings).toContainText(INVITATION_COPY);
	const settingsLink = settings.getByTestId("feedback-schedule-interview");
	await expect(settingsLink).toHaveAttribute("href", BOOKING_URL);
	await expect(settingsLink).toHaveAttribute("target", "_blank");
	await expect(settingsLink).toHaveAttribute("rel", "noopener noreferrer");
	const primaryTextColor = await page.evaluate(() => {
		const probe = document.createElement("span");
		probe.className = "text-control-primary-text";
		document.body.append(probe);
		const color = getComputedStyle(probe).color;
		probe.remove();
		return color;
	});
	await expect(settingsLink).toHaveCSS("color", primaryTextColor);
	const settingsPopupPromise = page.waitForEvent("popup");
	await settingsLink.click();
	const settingsPopup = await settingsPopupPromise;
	await settingsPopup.close();
	await expect.poll(() => actions).toEqual([]);
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();

	sendInvitation(browserSocket);
	const dialog = page.getByTestId("interview-prompt-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText("Help shape ThinkRail");
	await expect(dialog).toContainText(INVITATION_COPY);
	await expect(dialog.getByTestId("interview-postpone")).toBeFocused();

	rejectNextResponse = true;
	await dialog.getByTestId("interview-postpone").click();
	await expect(dialog).toBeVisible();
	await expect(
		page
			.locator('[data-testid="toast"][data-variant="error"]')
			.filter({ hasText: "feedback response failed" }),
	).toBeVisible();
	await dialog.getByTestId("interview-postpone").click();
	await expect(dialog).toBeHidden();
	await expect.poll(() => actions).toEqual(["postpone", "postpone"]);

	sendInvitation(browserSocket);
	await expect(dialog).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect.poll(() => actions.at(-1)).toBe("postpone");

	sendInvitation(browserSocket);
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "Close" }).click();
	await expect(dialog).toBeHidden();
	await expect.poll(() => actions.at(-1)).toBe("postpone");

	sendInvitation(browserSocket);
	await expect(dialog).toBeVisible();
	await page.getByTestId("dialog-overlay").click({ position: { x: 4, y: 4 } });
	await expect(dialog).toBeHidden();
	await expect.poll(() => actions.at(-1)).toBe("postpone");

	sendInvitation(browserSocket);
	await expect(dialog).toBeVisible();
	await dialog.getByTestId("interview-never").click();
	await expect(dialog).toBeHidden();
	await expect.poll(() => actions.at(-1)).toBe("never");

	sendInvitation(browserSocket);
	await expect(dialog).toBeVisible();
	if (!welcomeFrame) throw new Error("expected the host welcome frame");
	browserSocket?.send(welcomeFrame);
	await expect(dialog).toBeHidden();

	sendInvitation(browserSocket);
	await expect(dialog).toBeVisible();
	const bookingLink = dialog.getByTestId("interview-book");
	await expect(bookingLink).toHaveAttribute("href", BOOKING_URL);
	await expect(bookingLink).toHaveAttribute("target", "_blank");
	await expect(bookingLink).toHaveAttribute("rel", "noopener noreferrer");
	await expect(bookingLink).toHaveCSS("color", primaryTextColor);
	await bookingLink.dispatchEvent("auxclick", { button: 1 });
	await expect(dialog).toBeHidden();
	await expect.poll(() => actions.at(-1)).toBe("book");

	sendInvitation(browserSocket);
	await expect(dialog).toBeVisible();
	const bookingPopupPromise = page.waitForEvent("popup");
	await bookingLink.click();
	const bookingPopup = await bookingPopupPromise;
	await bookingPopup.close();
	await expect(dialog).toBeHidden();
	await expect.poll(() => actions.at(-1)).toBe("book");
});
