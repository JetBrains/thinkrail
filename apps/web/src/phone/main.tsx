import "@thinkrail/chat-ui/tools/register";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerWebExtensions } from "../extensions";
import { App } from "./App";
import "./phone.css";

registerWebExtensions();

const root = document.getElementById("root");
if (root)
	createRoot(root).render(
		<StrictMode>
			<TooltipProvider delayDuration={250} skipDelayDuration={400}>
				<App />
			</TooltipProvider>
		</StrictMode>,
	);
