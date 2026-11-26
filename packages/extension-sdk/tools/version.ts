export function versionMismatch(packageVersion: string, api: string): string | undefined {
	if (packageVersion === "0.0.0") return undefined;
	const [major, minor] = packageVersion.split(".");
	if (`${major}.${minor}` === api) return undefined;
	return `@thinkrail/extension-sdk ${packageVersion} builds extension API ${api}, so its version must be ${api}.x: the SDK's major.minor is the API it carries (only the unreleased 0.0.0 is exempt). Bump EXTENSION_API_VERSION with the SDK, or release the SDK as ${api}.0.`;
}
