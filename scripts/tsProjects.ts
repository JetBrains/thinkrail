import { join } from "node:path";
import type { SourceFile } from "typescript/unstable/ast";
import { API, type Project } from "typescript/unstable/async";

const SYNTAX_ONLY_OPTIONS = {
	allowJs: true,
	jsx: "preserve",
	noLib: true,
	noResolve: true,
	types: [],
};

export class VirtualTsProjects {
	private readonly configs = new Map<string, string>();
	readonly api: API;

	constructor(cwd: string) {
		this.api = new API({
			cwd,
			fs: {
				fileExists: (path) => (this.configs.has(path) ? true : undefined),
				readFile: (path) => this.configs.get(path),
			},
		});
	}

	define(configPath: string, config: unknown): void {
		this.configs.set(configPath, JSON.stringify(config));
	}

	async open(): Promise<ReadonlyMap<string, Project>> {
		const snapshot = await this.api.updateSnapshot({ openProjects: [...this.configs.keys()] });
		const projects = new Map<string, Project>();
		for (const path of this.configs.keys()) {
			const project = snapshot.getProject(path);
			if (project !== undefined) projects.set(path, project);
		}
		return projects;
	}

	close(): Promise<void> {
		return this.api.close();
	}
}

export type ParsedFile = (path: string) => Promise<SourceFile>;

export async function parseFiles<T>(
	cwd: string,
	files: readonly string[],
	run: (parsed: ParsedFile) => Promise<T>,
): Promise<T> {
	if (files.length === 0) {
		return run((path) => Promise.reject(new Error(`${path} was not scheduled for parsing`)));
	}
	const projects = new VirtualTsProjects(cwd);
	const configPath = join(cwd, "tsconfig.syntax-only.json");
	projects.define(configPath, { compilerOptions: SYNTAX_ONLY_OPTIONS, files });
	try {
		const project = (await projects.open()).get(configPath);
		if (project === undefined) throw new Error(`tsgo could not open ${configPath}`);
		return await run(async (path) => {
			const sourceFile = await project.program.getSourceFile(path);
			if (sourceFile === undefined) throw new Error(`tsgo did not parse ${path}`);
			return sourceFile;
		});
	} finally {
		await projects.close();
	}
}
