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
	handleBeforeQuit(event: DesktopBeforeQuitEvent): void;
	restartToUpdate(): Promise<void>;
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

	const beginShutdown = (): void => {
		if (shutdownPromise) return;
		shutdownPromise = Promise.resolve()
			.then(dependencies.shutdown)
			.catch(dependencies.reportLifecycleError)
			.then(finishShutdown);
	};

	return {
		handleBeforeQuit: (event) => {
			if (shutdownComplete) return;
			event.response = { allow: false };
			beginShutdown();
		},
		restartToUpdate: async () => {
			completionIntent = "update";
			if (initialApply) return initialApply;
			const operation = Promise.resolve().then(dependencies.applyUpdate);
			initialApply = operation;
			void operation.then(
				() => {
					if (!shutdownPromise && initialApply === operation) {
						initialApply = undefined;
						completionIntent = "quit";
					}
				},
				(error) => {
					dependencies.reportLifecycleError(error);
					if (!shutdownPromise && initialApply === operation) {
						initialApply = undefined;
						completionIntent = "quit";
					}
				},
			);
			return operation;
		},
	};
}
