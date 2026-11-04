import { expect, type Page, test, type WebSocketRoute } from "@playwright/test";
import { WS_CHANNELS } from "@thinkrail/contracts";

async function openWithHostSocket(page: Page): Promise<() => WebSocketRoute> {
	let browserSocket: WebSocketRoute | undefined;
	await page.routeWebSocket(/\/ws(\?|$)/, (socket) => {
		browserSocket = socket;
		const server = socket.connectToServer();
		socket.onMessage((message) => server.send(message));
		server.onMessage((message) => socket.send(message));
	});
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	return () => {
		if (!browserSocket) throw new Error("expected the app WebSocket");
		return browserSocket;
	};
}

function askForStar(socket: WebSocketRoute, stars: number | null): void {
	socket.send(JSON.stringify({ channel: WS_CHANNELS.feedbackGithubStar, data: { stars } }));
}

test("the host's star ask raises one toast with its star count, and the action opens the repo", async ({
	page,
	context,
}) => {
	await context.route("https://github.com/**", (route) =>
		route.fulfill({ status: 200, contentType: "text/html", body: "" }),
	);
	const socket = await openWithHostSocket(page);
	const ask = page
		.getByTestId("toast")
		.filter({ hasText: "Find ThinkRail useful or have feedback?" });
	await expect(ask).toHaveCount(0);

	askForStar(socket(), 1234);
	await expect(ask).toBeVisible();
	await expect(ask.getByTestId("toast-action")).toHaveText("View on GitHub | ☆ 1.2k");

	const [popup] = await Promise.all([
		context.waitForEvent("page"),
		ask.getByTestId("toast-action").click(),
	]);
	expect(popup.url()).toBe("https://github.com/JetBrains/thinkrail");
	await popup.close();
	await expect(ask).toHaveCount(0);
});

test("without a star count the button is plain, and the ask stays up for 60 seconds", async ({
	page,
}) => {
	await page.clock.install();
	const socket = await openWithHostSocket(page);
	const ask = page
		.getByTestId("toast")
		.filter({ hasText: "Find ThinkRail useful or have feedback?" });

	askForStar(socket(), null);
	await expect(ask).toBeVisible();
	await expect(ask.getByTestId("toast-action")).toHaveText("View on GitHub");
	await page.mouse.move(0, 0);
	await page.clock.fastForward(55_000);
	await expect(ask).toBeVisible();
	await page.clock.fastForward(6_000);
	await expect(ask).toHaveCount(0);
});
