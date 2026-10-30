import "./library.css";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initializeThemes } from "@/themes";
import { App } from "./App";

initializeThemes();

const root = document.getElementById("root");
if (root)
	createRoot(root).render(
		<StrictMode>
			<TooltipProvider delayDuration={250} skipDelayDuration={400}>
				<App />
			</TooltipProvider>
		</StrictMode>,
	);
