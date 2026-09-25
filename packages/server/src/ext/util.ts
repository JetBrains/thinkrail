export const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);
