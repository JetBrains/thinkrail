export interface RunBoundedOptions {
	failFast?: boolean;
	onFailFast?: () => void;
}

export const typeName = (value: unknown): string => (value === null ? "null" : typeof value);

export const parallelArgError = (tasks: unknown): string | undefined => {
	if (!Array.isArray(tasks)) return `parallel() expects an array of tasks, got ${typeName(tasks)}`;
	const notFn = tasks.findIndex((task) => typeof task !== "function");
	if (notFn >= 0) {
		return (
			`parallel() task ${notFn + 1} is not a function (got ${typeName(tasks[notFn])}); ` +
			"pass thunks, e.g. items.map(i => () => agent(i))"
		);
	}
	return undefined;
};

export const runBounded = async <T>(
	tasks: Array<() => Promise<T>>,
	opts: RunBoundedOptions = {},
) => {
	const results: Array<T | null> = new Array(tasks.length).fill(null);
	if (tasks.length === 0) return results;
	const { failFast = false, onFailFast } = opts;
	const failures: unknown[] = [];

	await Promise.all(
		tasks.map(async (task, index) => {
			try {
				results[index] = await task();
			} catch (error) {
				results[index] = null;
				if (!failFast) return;
				failures.push(error);
				if (failures.length === 1) onFailFast?.();
			}
		}),
	);

	if (failures.length > 0) throw failures[0];
	return results;
};

export type PipelineStage<T> = (prev: unknown, item: T, index: number) => unknown;

export interface RunPipelineOptions {
	shouldStop?: () => boolean;
}

export const pipelineArgError = <T>(
	items: readonly T[],
	stages: ReadonlyArray<PipelineStage<T>>,
): string | undefined => {
	if (!Array.isArray(items)) return `pipeline() expects an array of items, got ${typeName(items)}`;
	const notFn = stages.findIndex((stage) => typeof stage !== "function");
	if (notFn >= 0) {
		return `pipeline() stage ${notFn + 1} is not a function (got ${typeName(stages[notFn])})`;
	}
	return undefined;
};

export const runPipeline = async <T>(
	items: readonly T[],
	stages: ReadonlyArray<PipelineStage<T>>,
	opts: RunPipelineOptions = {},
): Promise<unknown[]> => {
	const badArgs = pipelineArgError(items, stages);
	if (badArgs) throw new TypeError(badArgs);

	const { shouldStop } = opts;
	const results: unknown[] = new Array(items.length).fill(null);

	await Promise.all(
		items.map(async (item, index) => {
			let value: unknown = item;
			for (const stage of stages) {
				if (shouldStop?.()) return;
				try {
					value = await stage(value, item, index);
				} catch {
					return;
				}
				if (value === null || value === undefined) return;
			}
			results[index] = value;
		}),
	);

	return results;
};
