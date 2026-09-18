import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FullConfig } from "@playwright/test";
import { removeTree } from "@thinkrail/shared/removeTree";
import { seedAgentDefinitionFixtures } from "./fixtures/agents";
import { CONFIRMED_ANALYTICS_CONFIG, seedAnalyticsConsent } from "./fixtures/analyticsConsent";
import {
	CentralSetupError,
	findGlobalCentralArtifact,
	isRealCentralE2e,
	removeCentralModeLocalSeeds,
	stageGlobalCentralArtifact,
	waitForCentralTarget,
	writeE2eAgentSettings,
} from "./fixtures/centralAgent";
import {
	E2E_CENTRAL_BAD_EXTENSION_SOURCE,
	E2E_CENTRAL_EXTENSION_SOURCE,
	E2E_CENTRAL_STATE,
	E2E_DATA_DIR,
	E2E_FAKE_BIN_DIR,
	E2E_FIXTURE_REPO,
	E2E_HOME_DIR,
	E2E_PI_AGENT_DIR,
	E2E_PI_MODELS_SEED,
	E2E_PICK_DIR_POINTER,
} from "./fixtures/paths";
import { seedFixtureRepo } from "./fixtures/repo";
import { seedExternalCwdSessions } from "./fixtures/sessions";
import { seedTemplateFixtures } from "./fixtures/templates";
import { E2eWire } from "./fixtures/wire";

function centralSetupFailure(error: unknown): Error {
	if (error instanceof CentralSetupError) return error;
	if (error instanceof Error && error.message.startsWith("THINKRAIL_E2E_MODEL")) return error;
	if (error instanceof Error && error.message.startsWith("Real-Central E2E requires")) return error;
	return new Error(
		"Real-Central E2E setup failed. Verify Central is installed and its global PI extension is current, then retry.",
	);
}

function seedLocalAgentConfiguration(): void {
	mkdirSync(E2E_PI_AGENT_DIR, { recursive: true });
	const userAgentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	for (const file of ["auth.json", "models.json"]) {
		const src = join(userAgentDir, file);
		if (existsSync(src)) copyFileSync(src, join(E2E_PI_AGENT_DIR, file));
	}
	const modelsSeedSrc = join(userAgentDir, "models.json");
	if (existsSync(modelsSeedSrc)) copyFileSync(modelsSeedSrc, E2E_PI_MODELS_SEED);
	else rmSync(E2E_PI_MODELS_SEED, { force: true });
	writeE2eAgentSettings();
}

export default function globalSetup(config?: FullConfig): void | Promise<void> {
	const centralMode = isRealCentralE2e();
	try {
		const globalCentralArtifact = centralMode ? findGlobalCentralArtifact() : undefined;
		rmSync(E2E_DATA_DIR, { recursive: true, force: true });
		mkdirSync(E2E_DATA_DIR, { recursive: true });
		writeFileSync(join(E2E_DATA_DIR, "config.json"), JSON.stringify(CONFIRMED_ANALYTICS_CONFIG));
		writeFileSync(
			join(E2E_DATA_DIR, "feedback.json"),
			JSON.stringify({ acceptedMessages: 0, nextInvitationAt: 10, dismissed: true }),
		);
		mkdirSync(E2E_HOME_DIR, { recursive: true });
		writeFileSync(join(E2E_HOME_DIR, ".zshrc"), "# ThinkRail e2e isolated shell\n");

		for (const rc of [".zshrc", ".bashrc"]) writeFileSync(join(E2E_HOME_DIR, rc), "");

		mkdirSync(E2E_FAKE_BIN_DIR, { recursive: true });
		for (const command of ["central", "code"]) {
			const target = join(E2E_FAKE_BIN_DIR, command);
			copyFileSync(new URL(`./fixtures/bin/${command}`, import.meta.url), target);
			chmodSync(target, 0o755);
		}
		copyFileSync(
			new URL("./fixtures/central-extension.ts.fixture", import.meta.url),
			E2E_CENTRAL_EXTENSION_SOURCE,
		);
		copyFileSync(
			new URL("./fixtures/central-extension-error.ts.fixture", import.meta.url),
			E2E_CENTRAL_BAD_EXTENSION_SOURCE,
		);
		writeFileSync(E2E_CENTRAL_STATE, "");

		if (centralMode && globalCentralArtifact) {
			mkdirSync(E2E_PI_AGENT_DIR, { recursive: true });
			stageGlobalCentralArtifact(globalCentralArtifact);
			writeE2eAgentSettings();
			removeCentralModeLocalSeeds();
		} else {
			seedLocalAgentConfiguration();
		}

		seedExternalCwdSessions();
		seedTemplateFixtures();
		seedAgentDefinitionFixtures();
		seedFixtureRepo();
		writeFileSync(E2E_PICK_DIR_POINTER, E2E_FIXTURE_REPO);
	} catch (error) {
		if (!centralMode) throw error;
		removeTree(E2E_DATA_DIR);
		throw centralSetupFailure(error);
	}

	const baseURL = config?.projects[0]?.use.baseURL;
	if (!centralMode) {
		return baseURL ? seedAnalyticsConsent(baseURL, false, true).then(() => undefined) : undefined;
	}
	return E2eWire.connect()
		.then(async (wire) => {
			try {
				await wire.request("settings.update", { config: CONFIRMED_ANALYTICS_CONFIG });
				await waitForCentralTarget(wire);
				removeCentralModeLocalSeeds();
			} finally {
				wire.close();
			}
		})
		.catch((error: unknown) => {
			removeTree(E2E_DATA_DIR);
			throw centralSetupFailure(error);
		});
}
