import { CodedError } from "./codedError";

const NOT_FOUND = /\bE404\b|\b404 Not Found\b|is not in this registry/;
const UNREACHABLE =
	/\b(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH)\b|\brequest to \S+ failed\b/;

export function packageInstallError(error: unknown): CodedError {
	const message = error instanceof Error ? error.message : String(error);
	if (NOT_FOUND.test(message)) return new CodedError("PACKAGE_NOT_FOUND", message);
	if (UNREACHABLE.test(message)) return new CodedError("PACKAGE_REGISTRY_UNREACHABLE", message);
	return new CodedError("PACKAGE_INSTALL_FAILED", message);
}
