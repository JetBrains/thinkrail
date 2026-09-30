export function openUiThenStartAttribution(
	enabled: boolean,
	url: string,
	openBrowser: (url: string) => void,
	startAttributionClaim: () => void,
): void {
	if (!enabled) return;
	openBrowser(url);
	startAttributionClaim();
}
