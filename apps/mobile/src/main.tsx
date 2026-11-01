import "@thinkrail/chat-ui/tools/register";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { followSystemTheme } from "./theme";
import "./index.css";

followSystemTheme();

const root = document.getElementById("root");
if (root)
	createRoot(root).render(
		<StrictMode>
			<TooltipProvider delayDuration={250} skipDelayDuration={400}>
				<App />
			</TooltipProvider>
		</StrictMode>,
	);
