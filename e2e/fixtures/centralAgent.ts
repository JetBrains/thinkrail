import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { jbcentralExtensionPath } from "@thinkrail/shared/jbcentral";
import {
	E2E_CENTRAL_ARTIFACT,
	E2E_CENTRAL_ARTIFACT_SEED,
	E2E_PI_AGENT_DIR,
	E2E_PI_MODELS_SEED,
} from "./paths";
import type { E2eWire } from "./wire";

export const REAL_CENTRAL_E2E_ENV = "THINKRAIL_E2E_REAL_CENTRAL";
export const CENTRAL_STUB_READ_ONLY_ENV = "CENTRAL_STUB_READ_ONLY";
export const DEFAULT_E2E_MODEL = "anthropic/claude-opus-4-8";

export interface E2eModelTarget {
	provider: string;
	id: string;
}

export class CentralSetupError extends Error {}

export function isRealCentralE2e(env: NodeJS.ProcessEnv = process.env): boolean {
	return env[REAL_CENTRAL_E2E_ENV] === "1";
}

export function resolveE2eModel(env: NodeJS.ProcessEnv = process.env): E2eModelTarget {
	const value = env.THINKRAIL_E2E_MODEL ?? DEFAULT_E2E_MODEL;
	const separator = value.indexOf("/");
	if (separator <= 0 || separator === value.length - 1) {
		throw new Error("THINKRAIL_E2E_MODEL must use the exact provider/modelId form");
	}
	return { provider: value.slice(0, separator), id: value.slice(separator + 1) };
}

export function writeE2eAgentSettings(
	agentDir: string = E2E_PI_AGENT_DIR,
	env: NodeJS.ProcessEnv = process.env,
): E2eModelTarget {
	const target = resolveE2eModel(env);
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(
		join(agentDir, "settings.json"),
		`${JSON.stringify(
			{
				defaultProvider: target.provider,
				defaultModel: target.id,
				defaultThinkingLevel: "low",
			},
			null,
			2,
		)}\n`,
	);
	return target;
}

export function removeLocalAgentModelAndAuth(agentDir: string = E2E_PI_AGENT_DIR): void {
	for (const file of ["auth.json", "models.json", "auth.json.bak", "models.json.bak"]) {
		rmSync(join(agentDir, file), { force: true });
	}
}

export function removeCentralModeLocalSeeds(): void {
	removeLocalAgentModelAndAuth();
	rmSync(E2E_PI_MODELS_SEED, { force: true });
}

export function findGlobalCentralArtifact(): string {
	const source = jbcentralExtensionPath();
	if (!existsSync(source) || !statSync(source).isFile()) {
		throw new Error(
			"Real-Central E2E requires a global Central extension. Run `central add pi` outside the suite, then retry.",
		);
	}
	return source;
}

function copyRestricted(source: string, destination: string): void {
	mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
	copyFileSync(source, destination);
	chmodSync(destination, 0o600);
}

export function stageGlobalCentralArtifact(
	source: string,
	seed: string = E2E_CENTRAL_ARTIFACT_SEED,
	destination: string = E2E_CENTRAL_ARTIFACT,
): void {
	copyRestricted(source, seed);
	copyRestricted(seed, destination);
}

export function restoreStagedCentralArtifact(
	destination: string = E2E_CENTRAL_ARTIFACT,
	seed: string = E2E_CENTRAL_ARTIFACT_SEED,
): void {
	copyRestricted(seed, destination);
}

export function preserveStagedCentralArtifact(
	destination: string = E2E_CENTRAL_ARTIFACT,
	seed: string = E2E_CENTRAL_ARTIFACT_SEED,
): void {
	if (existsSync(destination)) chmodSync(destination, 0o600);
	else restoreStagedCentralArtifact(destination, seed);
}

export function isExactE2eModel(
	model: E2eModelTarget | null | undefined,
	target: E2eModelTarget,
): boolean {
	return model?.provider === target.provider && model.id === target.id;
}

export async function waitForCentralTarget(
	wire: Pick<E2eWire, "request">,
	timeoutMs = 60_000,
): Promise<void> {
	const target = resolveE2eModel();
	const deadline = Date.now() + timeoutMs;
	let configured = false;
	while (Date.now() < deadline) {
		const status = await wire.request("provider.status", {});
		if (status.jbcentral.state === "configured") {
			configured = true;
			break;
		}
		if (status.jbcentral.state === "load-failed") {
			throw new CentralSetupError(
				"The isolated host could not load the staged Central extension. Refresh the global extension outside the suite, then retry.",
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	if (!configured) {
		throw new CentralSetupError(
			"The isolated host did not activate the staged Central extension. Verify Central is installed and retry.",
		);
	}
	const selected = await wire.request("model.default", {});
	if (!isExactE2eModel(selected.model, target)) {
		throw new CentralSetupError(
			"THINKRAIL_E2E_MODEL is not available as the isolated Central default. Choose an exact model exposed by the authorized Central extension, then retry.",
		);
	}
}
