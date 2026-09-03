export const E2E_IDLE_SLEEP_OWNER_ENV = "THINKRAIL_E2E_IDLE_SLEEP_OWNER";

interface IdleSleepProcess {
	exited: Promise<number>;
	unref(): void;
}

type IdleSleepSpawn = (command: string[]) => IdleSleepProcess;
type IdleSleepWait = (milliseconds: number) => Promise<void>;

interface HoldE2eIdleSleepOptions {
	env?: NodeJS.ProcessEnv;
	pid?: number;
	platform?: NodeJS.Platform;
	spawn?: IdleSleepSpawn;
	wait?: IdleSleepWait;
}

function spawnIdleSleepAssertion(command: string[]): IdleSleepProcess {
	return Bun.spawn(command, {
		stdin: "ignore",
		stdout: "ignore",
		stderr: "inherit",
		detached: true,
	});
}

export async function holdE2eIdleSleep(options: HoldE2eIdleSleepOptions = {}): Promise<boolean> {
	const env = options.env ?? process.env;
	if (env[E2E_IDLE_SLEEP_OWNER_ENV] === "1") return false;
	env[E2E_IDLE_SLEEP_OWNER_ENV] = "1";
	if ((options.platform ?? process.platform) !== "darwin") return false;

	const command = ["/usr/bin/caffeinate", "-i", "-w", String(options.pid ?? process.pid)];
	const assertion = (options.spawn ?? spawnIdleSleepAssertion)(command);
	const startupExit = await Promise.race([
		assertion.exited.then((exitCode) => exitCode),
		(options.wait ?? Bun.sleep)(25).then(() => null),
	]);
	if (startupExit !== null) {
		throw new Error(`macOS idle-sleep assertion exited during startup with code ${startupExit}`);
	}
	assertion.unref();
	return true;
}
