export class ExtensionBuildError extends Error {
	override readonly name: string = "ExtensionBuildError";
}

export class ExtensionUsageError extends ExtensionBuildError {
	override readonly name = "ExtensionUsageError";
}
