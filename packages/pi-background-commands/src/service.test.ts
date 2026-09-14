import { expect, test } from "bun:test";
import { type BackgroundCommandCompletion, createBackgroundCommands } from "../index";
import { controlledOperations, waitFor } from "./test-support";

function fixture() {
	const executor = controlledOperations();
	const service = createBackgroundCommands(
		{
			sessionId: "session",
			getContext: () => ({ cwd: process.cwd() }),
		},
		executor,
	);
	return { executor, service };
}

test("a real command acknowledges running, streams output, and settles successfully", async () => {
	const service = createBackgroundCommands({
		sessionId: "tracer-session",
		getContext: () => ({ cwd: process.cwd() }),
	});
	try {
		const command = service.start({ command: "printf tracer; sleep 0.1; printf done" });
		expect(command.snapshot.status).toBe("running");
		expect(service.find(command.id)).toBe(command);
		await waitFor(() => command.output?.text.includes("tracer") === true);
		await waitFor(() => command.snapshot.status === "completed");
		expect(command.snapshot.exitCode).toBe(0);
		expect(command.output?.text).toBe("tracerdone");
		expect(service.list()).toEqual([command.snapshot]);
	} finally {
		await service.dispose();
	}
});

test("admission counts stopping work, rejects invalid inputs, and never queues a ninth command", async () => {
	const { executor, service } = fixture();
	for (const input of [
		{ command: "" },
		{ command: "x".repeat(65537) },
		{ command: "🦊".repeat(16385) },
		{ command: "ok", name: "x".repeat(201) },
		{ command: "ok", timeout: 0 },
		{ command: "ok", timeout: Number.NaN },
		{ command: "ok", timeout: Infinity },
		{ command: "ok", timeout: 2147484 },
	])
		expect(() => service.start(input)).toThrow();
	expect(service.list()).toEqual([]);
	const commands = Array.from({ length: 8 }, () => service.start({ command: "wait" }));
	commands[0]?.stop();
	expect(() => service.start({ command: "overflow" })).toThrow(/eight|8/);
	expect(executor.calls).toHaveLength(8);
	for (const call of executor.calls) call.resolve({ exitCode: 0 });
	await waitFor(() => service.list().every((s) => s.finishedAt !== undefined));
	service.start({ command: "accepted" });
	executor.call(8).resolve({ exitCode: 0 });
	await service.dispose();
});

test("terminal settlement owns status, user stop is isolated and idempotent", async () => {
	const { executor, service } = fixture();
	const first = service.start({ command: "one" });
	const second = service.start({ command: "two" });
	let aborts = 0;
	executor.call().options.signal?.addEventListener("abort", () => {
		aborts++;
	});
	expect(first.stop().status).toBe("stopping");
	expect(first.stop().status).toBe("stopping");
	expect(first.snapshot.finishedAt).toBeUndefined();
	expect(aborts).toBe(1);
	expect(executor.call(1).options.signal?.aborted).toBe(false);
	executor.call().resolve({ exitCode: 0 });
	executor.call(1).resolve({ exitCode: 7 });
	await waitFor(() => first.snapshot.status === "stopped");
	expect(second.snapshot).toMatchObject({ status: "error", exitCode: 7 });
	expect(second.snapshot.errorMessage).toContain("7");
	expect(second.stop().status).toBe("error");
	await service.dispose();
});

test("unsignalled null exit and rejected launch remain bounded inspectable errors", async () => {
	const { executor, service } = fixture();
	const missingExit = service.start({ command: "null" });
	executor.call().resolve({ exitCode: null });
	const failed = service.start({ command: "fail" });
	executor.call(1).reject(new Error(`boom ${"🦊".repeat(20000)}`));
	await waitFor(() => failed.snapshot.status === "error");
	expect(missingExit.snapshot).toMatchObject({ status: "error", exitCode: null });
	expect(missingExit.snapshot.errorMessage).toContain("exit");
	expect(failed.snapshot.errorMessage).toStartWith("boom");
	expect(Buffer.byteLength(failed.snapshot.errorMessage ?? "")).toBeLessThanOrEqual(4096);
	expect(failed.snapshot.errorMessage).not.toContain("�");
	expect(service.find(failed.id)).toBe(failed);
	await service.dispose();
});

test("only the latest twenty settled records survive; active work is never evicted", async () => {
	const { executor, service } = fixture();
	const active = service.start({ command: "active" });
	const first = service.start({ command: "first" });
	executor.call(1).options.onData(Buffer.from("discard me"));
	executor.call(1).resolve({ exitCode: 0 });
	await waitFor(() => first.snapshot.status === "completed");
	for (let i = 0; i < 21; i++) {
		const handle = service.start({ command: `done ${i}` });
		executor.call(i + 2).resolve({ exitCode: 0 });
		await waitFor(() => handle.snapshot.status === "completed");
	}
	expect(service.list()).toHaveLength(21);
	expect(service.find(first.id)).toBeUndefined();
	expect(first.output).toBeUndefined();
	expect(service.find(active.id)).toBe(active);
	executor.call().resolve({ exitCode: 0 });
	await service.dispose();
});

test("streaming snapshots are non-consuming UTF-8-safe bounded tails, not byte change events", async () => {
	const { executor, service } = fixture();
	let changes = 0;
	const unsubscribe = service.onChange(() => {
		changes++;
	});
	const handle = service.start({ command: "logs" });
	const emit = executor.call().options.onData;
	const bytes = Buffer.from("🦊".repeat(20000));
	for (let offset = 0; offset < bytes.length; offset += 97)
		emit(bytes.subarray(offset, offset + 97));
	expect(changes).toBe(1);
	expect(handle.output?.text).toBe("🦊".repeat(12800));
	expect(handle.output?.truncated).toBe(true);
	expect(handle.output).toEqual(handle.output);
	emit(Buffer.from(`${"界".repeat(20000)}z`));
	expect(handle.output?.text).toBe(`${"界".repeat(17066)}z`);
	expect(handle.output?.text).not.toContain("�");
	const lines = Array.from({ length: 3000 }, (_, i) => `line${i}`).join("\n");
	emit(Buffer.from(`\n${lines}`));
	expect(handle.output?.text).toBe(lines.split("\n").slice(-2000).join("\n"));
	expect(Buffer.byteLength(handle.output?.text ?? "")).toBeLessThanOrEqual(51200);
	executor.call().resolve({ exitCode: 0 });
	await waitFor(() => handle.snapshot.status === "completed");
	const final = handle.output;
	emit(Buffer.from("late data"));
	expect(handle.output).toEqual(final);
	expect(changes).toBe(2);
	unsubscribe();
	await service.dispose();
});

test("completion latches survive rebind, gaps, a closed deletion gate and rollback", async () => {
	const executor = controlledOperations();
	let canDeliver = true;
	const service = createBackgroundCommands(
		{
			sessionId: "reload",
			getContext: () => ({ cwd: process.cwd() }),
			canDeliverCompletion: () => canDeliver,
		},
		executor,
	);
	const delivered: BackgroundCommandCompletion[] = [];
	const old: BackgroundCommandCompletion[] = [];
	const unbind = service.bindCompletion({
		deliver: (c) => {
			old.push(c);
		},
	});
	const handle = service.start({ command: "gap" });
	unbind();
	executor.call().resolve({ exitCode: 0 });
	await waitFor(() => handle.snapshot.status === "completed");
	canDeliver = false;
	service.bindCompletion({
		deliver: (c) => {
			delivered.push(c);
		},
	});
	service.flushCompletions();
	expect(delivered).toHaveLength(0);
	canDeliver = true;
	service.flushCompletions();
	unbind();
	service.bindCompletion({
		deliver: (c) => {
			delivered.push(c);
		},
	});
	service.flushCompletions();
	expect(old).toHaveLength(0);
	expect(delivered.map((c) => c.snapshot.id)).toEqual([handle.id]);
	await service.dispose();
});

test("reentrant completion bindings cannot claim twice and a failed send can be replayed", async () => {
	const { executor, service } = fixture();
	const handle = service.start({ command: "latch" });
	service.bindCompletion({
		deliver() {
			throw new Error("runtime unavailable");
		},
	});
	executor.call().resolve({ exitCode: 0 });
	await waitFor(() => handle.snapshot.status === "completed");
	let delivered = 0;
	service.bindCompletion({
		deliver() {
			delivered++;
			service.flushCompletions();
		},
	});
	service.flushCompletions();
	expect(delivered).toBe(1);
	await service.dispose();
});

test("disposal signals every job before waiting, closes admission, stays silent and is bounded", async () => {
	const { executor, service } = fixture();
	const one = service.start({ command: "one" });
	const two = service.start({ command: "two" });
	let delivered = 0;
	service.bindCompletion({
		deliver() {
			delivered++;
		},
	});
	const start = Date.now();
	const disposal = service.dispose({ timeoutMs: 20 });
	expect(executor.calls.every((c) => c.options.signal?.aborted)).toBe(true);
	expect(service.dispose()).toBe(disposal);
	expect(() => service.start({ command: "late" })).toThrow(/disposed/);
	await disposal;
	expect(Date.now() - start).toBeLessThan(500);
	expect(one.snapshot.status).toBe("stopping");
	expect(two.snapshot.status).toBe("stopping");
	executor.call().resolve({ exitCode: null });
	executor.call(1).reject(new Error("aborted"));
	await waitFor(() => one.snapshot.status === "stopped" && two.snapshot.status === "stopped");
	service.bindCompletion({
		deliver() {
			delivered++;
		},
	});
	expect(delivered).toBe(0);
});

test("each completion binding has independent ownership even when the callback object is reused", async () => {
	const { executor, service } = fixture();
	let deliveries = 0;
	const target = {
		deliver() {
			deliveries++;
		},
	};
	const oldUnbind = service.bindCompletion(target);
	service.bindCompletion(target);
	oldUnbind();
	const command = service.start({ command: "still bound" });
	executor.call().resolve({ exitCode: 0 });
	await waitFor(() => command.snapshot.status === "completed");
	expect(deliveries).toBe(1);
	await service.dispose();
});

test("real executor handles stderr, nonzero exit, null exit, launch failure and timeout", async () => {
	const service = createBackgroundCommands({
		sessionId: "real-errors",
		getContext: () => ({ cwd: process.cwd() }),
	});
	try {
		const failed = service.start({ command: "printf out; printf err >&2; exit 9" });
		const signalled = service.start({ command: "kill -TERM $$" });
		const timedOut = service.start({ command: "sleep 30", timeout: 0.03 });
		await waitFor(() =>
			[failed, signalled, timedOut].every((c) => c.snapshot.finishedAt !== undefined),
		);
		expect(failed.snapshot).toMatchObject({ status: "error", exitCode: 9 });
		expect(failed.output?.text).toContain("out");
		expect(failed.output?.text).toContain("err");
		expect(signalled.snapshot).toMatchObject({ status: "error", exitCode: null });
		expect(timedOut.snapshot.status).toBe("error");
		expect(timedOut.snapshot.errorMessage).toMatch(/timeout|timed out/);
	} finally {
		await service.dispose();
	}
	const broken = createBackgroundCommands({
		sessionId: "bad-shell",
		getContext: () => ({ cwd: process.cwd(), shellPath: "/no-such-background-shell" }),
	});
	try {
		const failed = broken.start({ command: "true" });
		await waitFor(() => failed.snapshot.status === "error");
		expect(failed.snapshot.errorMessage).toBeTruthy();
		expect(broken.find(failed.id)).toBe(failed);
	} finally {
		await broken.dispose();
	}
});

test("context, shell settings, timeout and session identity are captured independently for every launch", async () => {
	const executor = controlledOperations();
	const shells: Array<string | undefined> = [];
	let context = {
		cwd: "/first",
		commandPrefix: "export SETTING=one",
		shellPath: "/first-shell",
		sessionFile: "/first.jsonl",
	};
	const binding = { sessionId: "immutable", getContext: () => context };
	const service = createBackgroundCommands(binding, {
		createOperations(options) {
			shells.push(options.shellPath);
			return executor.createOperations();
		},
	});
	binding.sessionId = "mutated";
	const first = service.start({ command: "command1", timeout: 2 });
	context = {
		cwd: "/second",
		commandPrefix: "export SETTING=two",
		shellPath: "/second-shell",
		sessionFile: "/second.jsonl",
	};
	const second = service.start({ command: "command2" });
	expect(shells).toEqual(["/first-shell", "/second-shell"]);
	expect(executor.call().command).toBe("export SETTING=one\ncommand1");
	expect(executor.call().cwd).toBe("/first");
	expect(executor.call().options.timeout).toBe(2);
	expect(executor.call().options.env?.PI_SESSION_FILE).toBe("/first.jsonl");
	expect(executor.call(1).command).toBe("export SETTING=two\ncommand2");
	expect(executor.call(1).options.timeout).toBeUndefined();
	expect(executor.call(1).options.env?.PI_SESSION_ID).toBe("immutable");
	expect(first.snapshot.sessionId).toBe("immutable");
	expect(second.snapshot.sessionId).toBe("immutable");
	for (const call of executor.calls) call.resolve({ exitCode: 0 });
	await service.dispose();
});

test("failing observers cannot strand commands and synchronous launch failure remains a record", async () => {
	const service = createBackgroundCommands({
		sessionId: "broken-context",
		getContext() {
			throw new Error("context unavailable");
		},
	});
	service.onChange(() => {
		throw new Error("broken observer");
	});
	const failed = service.start({ command: "launch" });
	expect(failed.snapshot).toMatchObject({ status: "error", errorMessage: "context unavailable" });
	expect(service.list()).toHaveLength(1);
	await service.dispose();
});

test("split multibyte characters do not appear partially, and incomplete final bytes are decoded once", async () => {
	const { executor, service } = fixture();
	const command = service.start({ command: "utf8" });
	const bytes = Buffer.from("🦊");
	executor.call().options.onData(bytes.subarray(0, 3));
	expect(command.output?.text).toBe("");
	executor.call().options.onData(bytes.subarray(3));
	expect(command.output?.text).toBe("🦊");
	executor.call().options.onData(bytes.subarray(0, 2));
	executor.call().resolve({ exitCode: 0 });
	await waitFor(() => command.snapshot.status === "completed");
	expect(command.output).toEqual({ text: "🦊�", truncated: false });
	await service.dispose();
});
