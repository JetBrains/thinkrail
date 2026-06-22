import "./styles/tokens.css";
import "./styles/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "./shell/Shell";
import { applyFontScale } from "./utils/fontScale";
import { initTransport } from "./wireTransport";

applyFontScale();
initTransport();

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<StrictMode>
			<Shell />
		</StrictMode>,
	);
}
