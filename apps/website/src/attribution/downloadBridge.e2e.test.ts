import { describe, expect, test } from "bun:test";
import type { WebsiteAnalyticsEventProperties } from "@thinkrail/website-analytics";
import { initAnalyticsEvents } from "../analyticsEvents";
import { installCommands } from "../installCommands";
import {
	type AttributionStorage,
	readStoredAttributionContext,
	recordAttributionTouch,
	storeLatestAttributionBridge,
} from "./browserStorage";
import { runClaimPage } from "./claimPage";
import type { BindClaimRequest } from "./protocol";
import {
	initAttributionRecording,
	recordCurrentAttributionTouch,
	recordCurrentDownloadBridge,
} from "./recording";
import { type ClaimRecord, type ClaimRepository, ClaimService } from "./service";

const claimId = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCA";
const bridgeId = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA";
const fallbackBridgeId = "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFA";
const journeyId = "01890f47-75a3-4d8f-9a72-4f0e35be292b";
const now = 2_000_000_000_000;
const repositoryUrl = "https://github.com/JetBrains/thinkrail";
const desktopUrl =
	"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-darwin-arm64.dmg";
const linuxUrl =
	"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-linux-x64.tar.gz";

type Capture = <EventName extends keyof WebsiteAnalyticsEventProperties>(
	event: EventName,
	properties: WebsiteAnalyticsEventProperties[EventName],
) => void;

class FakeDocument {
	readonly listeners = new Map<string, EventListener[]>();

	addEventListener(type: string, listener: EventListener): void {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	dispatchClick(target: object): void {
		for (const listener of this.listeners.get("click") ?? []) {
			listener({ type: "click", button: 0, target } as unknown as Event);
		}
	}
}

function memoryStorage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key),
	};
}

function element({
	href,
	copy,
	within = [],
}: {
	href?: string;
	copy?: string;
	within?: readonly string[];
}) {
	const node = {
		closest(selector: string): unknown {
			if (selector === "a[href]") return href === undefined ? null : node;
			if (selector === "[data-copy]") return copy === undefined ? null : node;
			return within.includes(selector) ? node : null;
		},
		getAttribute(name: string): string | null {
			if (name === "href") return href ?? null;
			if (name === "data-copy") return copy ?? null;
			return null;
		},
	};
	return node;
}

const heroDownload = element({ href: desktopUrl, within: ["#readme"] });

function memoryClaimRepository(createdAt: number): ClaimRepository {
	let record: ClaimRecord = {
		claimId,
		challenge: "challenge:correct",
		createdAt,
		expiresAt: createdAt + 600_000,
	};
	return {
		async consumeCreateQuota() {
			return true;
		},
		async deleteExpired() {},
		async create() {
			return "created";
		},
		async bind(id, boundBridgeId, context) {
			if (id !== claimId || record.bridgeId !== undefined) return "missing";
			record = { ...record, bridgeId: boundBridgeId, context };
			return "bound";
		},
		async findVerified(id, challenge) {
			return id === claimId && challenge === record.challenge ? record : undefined;
		},
		async redeemVerified(id, challenge) {
			if (
				id !== claimId ||
				challenge !== record.challenge ||
				record.bridgeId === undefined ||
				record.context === undefined
			) {
				return undefined;
			}
			const redeemed: BindClaimRequest & { bridgeId: string } = {
				...record.context,
				bridgeId: record.bridgeId,
			};
			record = { ...record, challenge: "consumed" };
			return redeemed;
		},
	};
}

describe("desktop download bridge correlation", () => {
	test("preserves one bridge across download capture, browser context, bind, and redeem", async () => {
		const storage = memoryStorage();
		const document = new FakeDocument();
		const captured: Array<{ event: string; properties: Record<string, unknown> }> = [];
		const capture = ((event, properties) => captured.push({ event, properties })) as Capture;
		const recordTouch = () => {
			recordAttributionTouch(
				journeyId,
				"https://thinkrail.ai/?utm_source=newsletter",
				"",
				storage,
				now,
			);
		};
		initAnalyticsEvents(document, "/", capture, recordTouch, recordTouch, () =>
			storeLatestAttributionBridge(journeyId, storage, () => bridgeId, now),
		);
		document.dispatchClick(heroDownload);

		const download = captured.find(({ event }) => event === "download_started");
		expect(download?.properties.bridge_id).toBe(bridgeId);
		const storedContext = readStoredAttributionContext(storage, now);
		if (storedContext === undefined) throw new Error("expected a stored download context");
		expect(storedContext.bridge_id).toBe(bridgeId);

		const service = new ClaimService({
			repository: memoryClaimRepository(now),
			now: () => now,
			randomId: () => {
				throw new Error("a stored desktop bridge must not be replaced");
			},
			challengeForVerifier: async (verifier) => `challenge:${verifier}`,
		});

		const replacements: string[] = [];
		await runClaimPage({
			marketingGranted: () => true,
			readContext: () => storedContext,
			search: `?id=${claimId}`,
			requestTimeoutMs: 100,
			async request(_url, init) {
				const body = JSON.parse(String(init.body)) as BindClaimRequest;
				const result = await service.bind(claimId, body);
				if (result.status !== "ok") return new Response(null, { status: 409 });
				return new Response(JSON.stringify(result.value), { status: 200 });
			},
			replace(path) {
				replacements.push(path);
			},
		});
		expect(replacements).toEqual(["/blog/"]);
		expect(await service.redeem(claimId, "correct")).toEqual({
			status: "ok",
			value: { ...storedContext, bridge_id: bridgeId },
		});
	});
});

type Navigation = { readonly href: string; readonly referrer: string };

const campaign: Navigation = { href: "https://thinkrail.ai/?utm_source=newsletter", referrer: "" };
const search: Navigation = { href: "https://thinkrail.ai/", referrer: "https://www.google.com/" };
const direct: Navigation = { href: "https://thinkrail.ai/", referrer: "" };

const acquisitionNavigations = [
	["a campaign link", campaign],
	["a search result", search],
	[
		"a social post",
		{
			href: "https://thinkrail.ai/blog/introducing-thinkrail/",
			referrer: "https://www.linkedin.com/",
		},
	],
	[
		"an external article",
		{ href: "https://thinkrail.ai/", referrer: "https://news.ycombinator.com/" },
	],
] as const;

const browsingNavigations = [
	["a direct visit", direct],
	[
		"internal navigation",
		{ href: "https://thinkrail.ai/blog/", referrer: "https://thinkrail.ai/" },
	],
] as const;

function bridgeSequence(): () => string {
	let issued = 0;
	return () => {
		issued += 1;
		return `${String(issued).padStart(42, "D")}A`;
	};
}

function openPage(
	storage: AttributionStorage,
	navigation: Navigation,
	nextBridgeId: () => string,
	consented = true,
) {
	const document = new FakeDocument();
	const downloadBridges: Array<string | undefined> = [];
	let currentJourneyId = consented ? journeyId : undefined;
	let consent: boolean | undefined = consented ? true : undefined;
	let journeyListener: ((journeyId: string | undefined) => void) | undefined;
	const dependencies = {
		currentJourneyId: () => currentJourneyId,
		currentMarketingConsent: () => consent,
		subscribeJourney(listener: (journeyId: string | undefined) => void) {
			journeyListener = listener;
			return () => {
				journeyListener = undefined;
			};
		},
		storage: () => storage,
		href: () => navigation.href,
		referrer: () => navigation.referrer,
		generateBridgeId: nextBridgeId,
		recordedJourneys: new Set<string>(),
	};
	const capture = ((event, properties) => {
		if (event !== "download_started") return;
		downloadBridges.push(
			(properties as WebsiteAnalyticsEventProperties["download_started"]).bridge_id,
		);
	}) as Capture;
	initAnalyticsEvents(
		document,
		new URL(navigation.href).pathname,
		capture,
		() => initAttributionRecording(dependencies),
		() => recordCurrentAttributionTouch(dependencies),
		() => recordCurrentDownloadBridge(dependencies),
	);
	return {
		downloadBridges,
		click: (target: object) => document.dispatchClick(target),
		touch: () => recordCurrentAttributionTouch(dependencies),
		grant(nextJourneyId: string) {
			currentJourneyId = nextJourneyId;
			consent = true;
			journeyListener?.(nextJourneyId);
		},
		deny() {
			currentJourneyId = undefined;
			consent = false;
			journeyListener?.(undefined);
		},
	};
}

type Page = ReturnType<typeof openPage>;

const sameDocumentActions = [
	[
		"clicks the download dialog's GitHub card",
		(page: Page) => page.click(element({ href: repositoryUrl })),
	],
	[
		"opens the dialog's privacy link",
		(page: Page) => page.click(element({ href: `${repositoryUrl}#analytics--privacy` })),
	],
	[
		"clicks the hero's View on GitHub",
		(page: Page) => page.click(element({ href: repositoryUrl, within: ["#readme"] })),
	],
	[
		"copies an install command",
		(page: Page) => page.click(element({ copy: installCommands.macos, within: ["#install"] })),
	],
	["takes another tracked action", (page: Page) => page.touch()],
] as const;

async function claimBridge(storage: AttributionStorage): Promise<string | undefined> {
	const service = new ClaimService({
		repository: memoryClaimRepository(Date.now()),
		now: () => Date.now(),
		randomId: () => fallbackBridgeId,
		challengeForVerifier: async (verifier) => `challenge:${verifier}`,
	});
	await runClaimPage({
		marketingGranted: () => true,
		readContext: () => readStoredAttributionContext(storage),
		search: `?id=${claimId}`,
		requestTimeoutMs: 100,
		async request(_url, init) {
			const result = await service.bind(claimId, JSON.parse(String(init.body)));
			if (result.status !== "ok") return new Response(null, { status: 409 });
			return new Response(JSON.stringify(result.value), { status: 200 });
		},
		replace() {},
	});
	const redeemed = await service.redeem(claimId, "correct");
	return redeemed.status === "ok" ? redeemed.value.bridge_id : undefined;
}

describe("desktop download bridge after later actions", () => {
	describe.each([...acquisitionNavigations, ...browsingNavigations])(
		"on a page reached from %s",
		(_navigationName, navigation) => {
			test.each(sameDocumentActions)(
				"keeps the download's bridge when the visitor %s",
				async (_actionName, act) => {
					const storage = memoryStorage();
					const page = openPage(storage, navigation, bridgeSequence());
					page.click(heroDownload);
					act(page);
					act(page);

					const [downloadBridge] = page.downloadBridges;
					expect(downloadBridge).toBeDefined();
					expect(await claimBridge(storage)).toBe(downloadBridge);
				},
			);

			test("hands the claim the latest of two downloads", async () => {
				const storage = memoryStorage();
				const page = openPage(storage, navigation, bridgeSequence());
				page.click(heroDownload);
				page.click(element({ href: linuxUrl, within: ["#install"] }));

				const [first, latest] = page.downloadBridges;
				expect(latest).toBeDefined();
				expect(latest).not.toBe(first);
				expect(await claimBridge(storage)).toBe(latest);
			});
		},
	);

	test.each(acquisitionNavigations)(
		"a later page reached from %s starts a new acquisition without the bridge",
		async (_navigationName, navigation) => {
			const storage = memoryStorage();
			const bridges = bridgeSequence();
			openPage(storage, direct, bridges).click(heroDownload);
			openPage(storage, navigation, bridges);

			expect(await claimBridge(storage)).toBe(fallbackBridgeId);
		},
	);

	test.each(browsingNavigations)(
		"a later page reached by %s keeps the bridge",
		async (_navigationName, navigation) => {
			const storage = memoryStorage();
			const bridges = bridgeSequence();
			const downloadPage = openPage(storage, campaign, bridges);
			downloadPage.click(heroDownload);
			openPage(storage, navigation, bridges);

			expect(await claimBridge(storage)).toBe(downloadPage.downloadBridges[0]);
		},
	);

	test("an older tab's download keeps a newer tab's acquisition as the last touch", async () => {
		const storage = memoryStorage();
		const bridges = bridgeSequence();
		const olderTab = openPage(storage, campaign, bridges);
		openPage(storage, search, bridges);
		olderTab.click(heroDownload);
		olderTab.click(element({ href: repositoryUrl }));

		expect(readStoredAttributionContext(storage)?.last_touch.referrer_class).toBe("search");
		expect(await claimBridge(storage)).toBe(olderTab.downloadBridges[0]);
	});

	test("a download before consent stays bridge-less while a later grant links the journey", async () => {
		const storage = memoryStorage();
		const page = openPage(storage, campaign, bridgeSequence(), false);
		page.click(heroDownload);
		page.grant(journeyId);
		page.click(element({ href: repositoryUrl }));

		expect(page.downloadBridges).toEqual([undefined]);
		expect(await claimBridge(storage)).toBe(fallbackBridgeId);
	});

	test("withdrawn consent leaves nothing to claim", async () => {
		const storage = memoryStorage();
		const page = openPage(storage, campaign, bridgeSequence());
		page.click(heroDownload);
		page.deny();

		expect(await claimBridge(storage)).toBeUndefined();
	});
});
