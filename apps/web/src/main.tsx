import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "./shell/Shell";
import { initTransport } from "./transport";
import { applyFontScale } from "./utils/fontScale";

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
