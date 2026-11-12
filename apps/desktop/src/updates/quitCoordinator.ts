export interface DesktopBeforeQuitEvent {
	response: { allow: boolean } | undefined;
}

export interface DesktopQuitCoordinatorDependencies {
	shutdown(): Promise<void>;
	quit(): void;
	applyUpdate(): Promise<void>;
	getUpdateError(): string;
	reportUpdateFailure(message: string): Promise<void>;
	reportLifecycleError(error: unknown): void;
}

export interface DesktopQuitCoordinator {
	quit(): Promise<void>;
	handleBeforeQuit(event: DesktopBeforeQuitEvent): void;
	restartToUpdate(): Promise<boolean>;
}

export function createDesktopQuitCoordinator(
	dependencies: DesktopQuitCoordinatorDependencies,
): DesktopQuitCoordinator {
	let shutdownComplete = false;
	let shutdownPromise: Promise<void> | undefined;
	let completionStarted = false;
	let completionIntent: "quit" | "update" = "quit";
	let initialApply: Promise<void> | undefined;

	const ordinaryQuit = (): void => {
		try {
			dependencies.quit();
		} catch (error) {
			dependencies.reportLifecycleError(error);
		}
	};

	const finishUpdate = async (): Promise<void> => {
		try {
			await initialApply;
		} catch (error) {
			dependencies.reportLifecycleError(error);
		}

		let failure: string | null = null;
		try {
			await dependencies.applyUpdate();
			failure = dependencies.getUpdateError() || null;
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		}
		if (!failure) return;

		try {
			await dependencies.reportUpdateFailure(failure);
		} catch (error) {
			dependencies.reportLifecycleError(error);
		}
		ordinaryQuit();
	};

	const finishShutdown = async (): Promise<void> => {
		if (completionStarted) return;
		completionStarted = true;
		shutdownComplete = true;
		if (completionIntent === "update") {
			await finishUpdate();
			return;
		}
		ordinaryQuit();
	};

	const beginShutdown = (): Promise<void> => {
		shutdownPromise ??= Promise.resolve()
			.then(dependencies.shutdown)
			.catch(dependencies.reportLifecycleError)
			.then(finishShutdown);
		return shutdownPromise;
	};

	return {
		quit: beginShutdown,
		handleBeforeQuit: (event) => {
			if (shutdownComplete) return;
			event.response = { allow: false };
			void beginShutdown();
		},
		restartToUpdate: async () => {
			completionIntent = "update";
			let operation = initialApply;
			if (!operation) {
				const started = Promise.resolve().then(dependencies.applyUpdate);
				operation = started;
				initialApply = started;
				void started.then(
					() => {
						if (!shutdownPromise && initialApply === started) {
							initialApply = undefined;
							completionIntent = "quit";
						}
					},
					(error) => {
						dependencies.reportLifecycleError(error);
						if (!shutdownPromise && initialApply === started) {
							initialApply = undefined;
							completionIntent = "quit";
						}
					},
				);
			}
			await operation;
			return shutdownPromise !== undefined;
		},
	};
}
