import { dlopen } from "bun:ffi";
import { fileURLToPath } from "node:url";
import { runBounded } from "./runBounded";

const kernel = dlopen("kernel32.dll", {
	GetConsoleWindow: { args: [], returns: "ptr" },
	GetConsoleCP: { args: [], returns: "u32" },
	FreeConsole: { args: [], returns: "bool" },
});
const user = dlopen("user32.dll", {
	IsWindowVisible: { args: ["ptr"], returns: "bool" },
});

function consoleState() {
	const window = kernel.symbols.GetConsoleWindow();
	return {
		window,
		codePage: kernel.symbols.GetConsoleCP(),
		visible: window !== null && user.symbols.IsWindowVisible(window),
	};
}

const argv = (mode: string) => [process.execPath, fileURLToPath(import.meta.url), mode];

async function capture(mode: string, detached: boolean, windowsHide: boolean): Promise<unknown> {
	const child = Bun.spawn(argv(mode), {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		detached,
		windowsHide,
	});
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== 0) throw new Error(`console fixture exited ${code}: ${err}`);
	return JSON.parse(out);
}

try {
	const mode = process.argv[2];
	if (mode === "probe") {
		console.log(JSON.stringify(consoleState()));
	} else if (mode === "child") {
		const self = consoleState();
		const grandchild = await capture("probe", false, false);
		console.log(JSON.stringify({ self, grandchild }));
	} else if (mode === "bounded" || mode === "detached-control") {
		kernel.symbols.FreeConsole();
		const driver = consoleState();
		let child: unknown;
		if (mode === "bounded") {
			const result = await runBounded(argv("child"), { timeoutMs: 5_000 });
			if (!result.ok) throw new Error(`bounded console fixture failed: ${result.err}`);
			child = JSON.parse(result.out);
		} else {
			child = await capture("child", true, true);
		}
		console.log(JSON.stringify({ driver, child }));
	} else {
		throw new Error(`unknown console fixture mode: ${mode}`);
	}
} finally {
	user.close();
	kernel.close();
}
