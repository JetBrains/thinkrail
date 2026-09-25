import { describe, expect, test } from "bun:test";
import type { WebsiteAnalyticsEventProperties } from "@thinkrail/website-analytics";
import { initAnalyticsEvents } from "../analyticsEvents";
import {
	readStoredAttributionContext,
	recordAttributionTouch,
	storeLatestAttributionBridge,
} from "./browserStorage";
import type { BindClaimRequest } from "./protocol";
import { type ClaimRecord, type ClaimRepository, ClaimService } from "./service";

const claimId = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCA";
const bridgeId = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA";
const journeyId = "01890f47-75a3-4d8f-9a72-4f0e35be292b";
const now = 2_000_000_000_000;
const desktopUrl =
	"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-darwin-arm64.dmg";

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

describe("desktop download bridge correlation", () => {
	test("preserves one bridge across download capture, browser context, bind, and redeem", async () => {
		const storage = memoryStorage();
		const document = new FakeDocument();
		const captured: Array<{ event: string; properties: Record<string, unknown> }> = [];
		const capture = ((event, properties) => captured.push({ event, properties })) as Capture;
		const recordTouch = () => {
			recordAttributionTouch(
				journeyId,
				"landing",
				"https://thinkrail.ai/?utm_source=newsletter",
				"",
				storage,
				now,
			);
		};
		initAnalyticsEvents(document, "/", capture, recordTouch, recordTouch, () =>
			storeLatestAttributionBridge(journeyId, storage, () => bridgeId, now),
		);
		document.dispatchClick({
			closest(selector: string) {
				return selector === "a[href]" || selector === "#readme" ? this : null;
			},
			getAttribute(name: string) {
				return name === "href" ? desktopUrl : null;
			},
		});

		const download = captured.find(({ event }) => event === "download_started");
		expect(download?.properties.bridge_id).toBe(bridgeId);
		const storedContext = readStoredAttributionContext(storage, now);
		if (storedContext === undefined) throw new Error("expected a stored download context");
		expect(storedContext.bridge_id).toBe(bridgeId);

		let record: ClaimRecord = {
			claimId,
			challenge: "challenge:correct",
			createdAt: now,
			expiresAt: now + 600_000,
		};
		const repository: ClaimRepository = {
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
		const service = new ClaimService({
			repository,
			now: () => now,
			randomId: () => {
				throw new Error("a stored desktop bridge must not be replaced");
			},
			challengeForVerifier: async (verifier) => `challenge:${verifier}`,
		});

		expect(await service.bind(claimId, storedContext)).toEqual({
			status: "ok",
			value: { bridge_id: bridgeId },
		});
		expect(await service.redeem(claimId, "correct")).toEqual({
			status: "ok",
			value: { ...storedContext, bridge_id: bridgeId },
		});
	});
});
