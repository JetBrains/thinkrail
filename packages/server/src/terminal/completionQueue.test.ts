import { describe, expect, test } from "bun:test";
import { WS_CHANNELS } from "@thinkrail/contracts";
import { createTerminalCompletionQueue } from "./completionQueue";
import type { TerminalDeliveryResult } from "./outputBatcher";

interface Attempt {
	channel: string;
	data: unknown;
}

function harness() {
	const attempts: Attempt[] = [];
	const outcomes: TerminalDeliveryResult[] = [];
	const queue = createTerminalCompletionQueue((_clientKey, channel, data) => {
		attempts.push({ channel, data });
		return outcomes.shift() ?? "delivered";
	});
	return { attempts, outcomes, queue };
}

const completion = () => ({
	data: { id: "pty-1", data: "final output", truncated: false },
	exit: { id: "pty-1", exitCode: 7 },
});

describe("terminal completion queue", () => {
	test("retries unavailable final data before sending the exit", () => {
		const { attempts, outcomes, queue } = harness();
		outcomes.push("unavailable");
		queue.enqueue("page", completion());
		expect(attempts.map((attempt) => attempt.channel)).toEqual([WS_CHANNELS.terminalData]);

		queue.resume("page");
		expect(attempts.map((attempt) => attempt.channel)).toEqual([
			WS_CHANNELS.terminalData,
			WS_CHANNELS.terminalData,
			WS_CHANNELS.terminalExit,
		]);
	});

	test("does not replay accepted data when its send backpressures", () => {
		const { attempts, outcomes, queue } = harness();
		outcomes.push("backpressured");
		queue.enqueue("page", completion());
		expect(attempts.map((attempt) => attempt.channel)).toEqual([WS_CHANNELS.terminalData]);

		queue.resume("page");
		expect(attempts.map((attempt) => attempt.channel)).toEqual([
			WS_CHANNELS.terminalData,
			WS_CHANNELS.terminalExit,
		]);
	});

	test("holds an unavailable exit without replaying its accepted data", () => {
		const { attempts, outcomes, queue } = harness();
		outcomes.push("delivered", "unavailable");
		queue.enqueue("page", completion());
		queue.resume("page");

		expect(attempts.map((attempt) => attempt.channel)).toEqual([
			WS_CHANNELS.terminalData,
			WS_CHANNELS.terminalExit,
			WS_CHANNELS.terminalExit,
		]);
	});

	test("clearing an abandoned client drops its completion", () => {
		const { attempts, outcomes, queue } = harness();
		outcomes.push("unavailable");
		queue.enqueue("page", completion());
		queue.clearClient("page");
		queue.resume("page");
		expect(attempts).toHaveLength(1);
	});
});
