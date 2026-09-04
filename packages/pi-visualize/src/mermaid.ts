import { parseHTML } from "linkedom";

type Mermaid = typeof import("mermaid")["default"];
type DomGlobalName = "document" | "window";

const parseTailKey = Symbol.for("pi-visualize.mermaid.parseTail");
let mermaidPromise: Promise<Mermaid> | undefined;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function restoreGlobal(name: DomGlobalName, descriptor: PropertyDescriptor | undefined): void {
	if (descriptor) {
		Object.defineProperty(globalThis, name, descriptor);
	} else {
		Reflect.deleteProperty(globalThis, name);
	}
}

async function importMermaid(): Promise<Mermaid> {
	const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
	const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
	const { window } = parseHTML("<!doctype html><html><body></body></html>");
	try {
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: window,
			writable: true,
		});
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: window.document,
			writable: true,
		});
		return (await import("mermaid")).default;
	} finally {
		restoreGlobal("document", documentDescriptor);
		restoreGlobal("window", windowDescriptor);
	}
}

function loadMermaid(): Promise<Mermaid> {
	mermaidPromise ??= importMermaid();
	return mermaidPromise;
}

function parseTail(mermaid: Mermaid): Promise<void> {
	const current = Reflect.get(mermaid, parseTailKey);
	return current instanceof Promise ? current : Promise.resolve();
}

async function parseMermaid(source: string): Promise<void> {
	const mermaid = await loadMermaid();
	const current = parseTail(mermaid).then(async () => {
		await mermaid.parse(source);
	});
	Object.defineProperty(mermaid, parseTailKey, {
		configurable: true,
		value: current.catch(() => undefined),
	});
	return current;
}

export async function validateMermaidSyntax(location: string, source: string): Promise<void> {
	try {
		await parseMermaid(source);
	} catch (error) {
		throw new Error(
			`visualize: invalid Mermaid syntax in \`${location}\`: ${errorMessage(error)}\nCorrect the syntax and call \`visualize\` again.`,
		);
	}
}
