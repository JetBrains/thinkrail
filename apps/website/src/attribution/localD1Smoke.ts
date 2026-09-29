import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const websiteDirectory = join(import.meta.dir, "../..");
const wrangler = ["bunx", "wrangler@4.124.0"] as const;
const verifier = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const sharedBridgeId = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA";
const journeyIds = [
	"01890f47-75a3-4d8f-9a72-4f0e35be292b",
	"4c1829b0-f3a7-4db7-b09c-c638fb394b4e",
] as const;

type CommandResult = { exitCode: number; stdout: string; stderr: string };
type HttpResult = { status: number; body: unknown };

async function execute(command: readonly string[]): Promise<CommandResult> {
	const child = Bun.spawn([...command], {
		cwd: websiteDirectory,
		env: { ...process.env, CI: "true" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

async function run(command: readonly string[]): Promise<void> {
	const result = await execute(command);
	if (result.exitCode !== 0) {
		throw new Error(
			`Command failed (${command.join(" ")}):\n${result.stdout}\n${result.stderr}`.trim(),
		);
	}
}

async function sha256Base64Url(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Buffer.from(digest).toString("base64url");
}

async function request(
	port: number,
	path: string,
	method = "GET",
	body?: unknown,
	origin?: string,
): Promise<HttpResult> {
	const command = [
		"curl",
		"--silent",
		"--show-error",
		"--insecure",
		"--noproxy",
		"*",
		"--connect-to",
		`thinkrail.ai:443:127.0.0.1:${port}`,
		"--max-time",
		"3",
		"--request",
		method,
		"--write-out",
		"\n%{http_code}",
	];
	if (body !== undefined) {
		command.push("--header", "Content-Type: application/json", "--data", JSON.stringify(body));
	}
	if (origin !== undefined) command.push("--header", `Origin: ${origin}`);
	command.push(`https://thinkrail.ai${path}`);
	const result = await execute(command);
	if (result.exitCode !== 0) {
		throw new Error(result.stderr || `curl exited ${result.exitCode}`);
	}
	const separator = result.stdout.lastIndexOf("\n");
	if (separator < 0) throw new Error(`Missing HTTP status: ${result.stdout}`);
	const status = Number(result.stdout.slice(separator + 1));
	const responseBody = result.stdout.slice(0, separator);
	let parsedBody: unknown;
	try {
		parsedBody = responseBody.length === 0 ? undefined : (JSON.parse(responseBody) as unknown);
	} catch {
		parsedBody = responseBody;
	}
	return { status, body: parsedBody };
}

function expectStatus(result: HttpResult, status: number, operation: string): void {
	if (result.status !== status) {
		throw new Error(`${operation} returned ${result.status}: ${JSON.stringify(result.body)}`);
	}
}

async function reservePort(): Promise<number> {
	const reservation = Bun.serve({ port: 0, fetch: () => new Response(null) });
	const port = reservation.port;
	await reservation.stop(true);
	if (port === undefined) throw new Error("Failed to reserve a local port");
	return port;
}

function spawnPages(command: string[]) {
	return Bun.spawn(command, {
		cwd: websiteDirectory,
		env: { ...process.env, CI: "true" },
		stdout: "pipe",
		stderr: "pipe",
	});
}

export async function runLocalD1Smoke(): Promise<void> {
	const stateDirectory = await mkdtemp(join(tmpdir(), "thinkrail-attribution-d1-"));
	const port = await reservePort();
	let pagesProcess: ReturnType<typeof spawnPages> | undefined;
	let pagesOutput: Promise<[string, string]> | undefined;
	try {
		await run([
			...wrangler,
			"d1",
			"migrations",
			"apply",
			"ATTRIBUTION_DB",
			"--local",
			"--persist-to",
			stateDirectory,
		]);

		pagesProcess = spawnPages([
			...wrangler,
			"pages",
			"dev",
			"dist",
			"--port",
			String(port),
			"--local-protocol",
			"https",
			"--persist-to",
			stateDirectory,
			"--log-level",
			"warn",
			"--show-interactive-dev-session=false",
		]);
		pagesOutput = Promise.all([
			new Response(pagesProcess.stdout).text(),
			new Response(pagesProcess.stderr).text(),
		]);

		let ready = false;
		let readinessError = "no response";
		for (let attempt = 0; attempt < 60; attempt += 1) {
			if (typeof pagesProcess.exitCode === "number") break;
			try {
				const response = await request(port, "/attribution/claim/");
				if (response.status === 200) {
					ready = true;
					break;
				}
			} catch (error) {
				readinessError = error instanceof Error ? error.message : String(error);
			}
			await Bun.sleep(100);
		}
		if (!ready) {
			pagesProcess.kill();
			const [stdout, stderr] = await pagesOutput;
			throw new Error(
				`Local Pages server did not start (${readinessError}):\n${stdout}\n${stderr}`.trim(),
			);
		}

		const challenge = await sha256Base64Url(verifier);
		const createdClaims: Array<{ claimId: string; journeyId: string }> = [];
		for (const journeyId of journeyIds) {
			const create = await request(port, "/api/attribution/claims", "POST", { challenge });
			expectStatus(create, 201, "create");
			const claimId = (create.body as { claim_id?: unknown }).claim_id;
			if (typeof claimId !== "string") throw new Error("Create response omitted claim_id");
			createdClaims.push({ claimId, journeyId });

			const touchedAt = Date.now();
			const bind = await request(
				port,
				`/api/attribution/claims/${claimId}/bind`,
				"POST",
				{
					journey_id: journeyId,
					bridge_id: sharedBridgeId,
					first_touch: {
						referrer_class: "direct",
						landing_content_key: "landing",
						touched_at: touchedAt,
						policy_version: 1,
					},
					last_touch: {
						referrer_class: "direct",
						landing_content_key: "landing",
						touched_at: touchedAt,
						policy_version: 1,
					},
				},
				"https://thinkrail.ai",
			);
			expectStatus(bind, 200, "bind");
		}
		if (new Set(createdClaims.map(({ claimId }) => claimId)).size !== journeyIds.length) {
			throw new Error("Create did not return distinct claim IDs");
		}
		for (const { claimId, journeyId } of createdClaims) {
			const redeem = await request(port, `/api/attribution/claims/${claimId}/redeem`, "POST", {
				verifier,
			});
			expectStatus(redeem, 200, "redeem");
			const redeemed = redeem.body as { bridge_id?: unknown; journey_id?: unknown };
			if (redeemed.bridge_id !== sharedBridgeId || redeemed.journey_id !== journeyId) {
				throw new Error(`Unexpected redeem response: ${JSON.stringify(redeem.body)}`);
			}

			const replay = await request(port, `/api/attribution/claims/${claimId}/redeem`, "POST", {
				verifier,
			});
			expectStatus(replay, 404, "redeem replay");
		}
		const millisecondsLeftInBucket = 60_000 - (Date.now() % 60_000);
		if (millisecondsLeftInBucket < 10_000) await Bun.sleep(millisecondsLeftInBucket + 100);
		const minuteBucket = Math.floor(Date.now() / 60_000);
		await run([
			...wrangler,
			"d1",
			"execute",
			"ATTRIBUTION_DB",
			"--local",
			"--persist-to",
			stateDirectory,
			"--command",
			`INSERT INTO attribution_create_quota (minute_bucket, create_count) VALUES (${minuteBucket}, 999), (${minuteBucket + 1}, 999) ON CONFLICT (minute_bucket) DO UPDATE SET create_count = 999`,
		]);
		const finalPermitted = await request(port, "/api/attribution/claims", "POST", { challenge });
		expectStatus(finalPermitted, 201, "1,000th create");
		const exhausted = await request(port, "/api/attribution/claims", "POST", { challenge });
		expectStatus(exhausted, 429, "quota-exhausted create");
		console.log(
			"Local Pages/D1 attribution smoke passed (migration, quota, and two claims sharing one bridge).",
		);
	} finally {
		if (pagesProcess !== undefined) {
			pagesProcess.kill();
			await pagesProcess.exited;
		}
		await rm(stateDirectory, { recursive: true, force: true });
	}
}

if (import.meta.main) await runLocalD1Smoke();
