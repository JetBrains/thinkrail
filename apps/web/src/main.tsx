import { PROTOCOL_VERSION } from "@thinkrail-pi/contracts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<StrictMode>
			<div>ThinkRail-PI — protocol v{PROTOCOL_VERSION}</div>
		</StrictMode>,
	);
}
