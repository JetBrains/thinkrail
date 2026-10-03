import { QuitHintOverlay } from "./QuitHintOverlay";
import { useAppShortcuts } from "./useAppShortcuts";

export function AppShortcuts() {
	const quitHint = useAppShortcuts();
	return quitHint ? <QuitHintOverlay hint={quitHint} /> : null;
}
