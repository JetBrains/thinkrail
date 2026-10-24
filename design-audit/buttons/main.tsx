import "./buttons.css";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { createRoot } from "react-dom/client";
import { installForcedPseudoStates } from "../catalog/pseudo";
import { ButtonsCatalog } from "./ButtonsCatalog";

function start() {
	const forcedRules = installForcedPseudoStates();
	const root = document.getElementById("root");
	if (root)
		createRoot(root).render(
			<TooltipProvider delayDuration={250} skipDelayDuration={400}>
				<ButtonsCatalog forcedRules={forcedRules} />
			</TooltipProvider>,
		);
}

const prod = document.querySelector("link[data-dsa-production]") as HTMLLinkElement | null;
if (prod && !prod.sheet) prod.addEventListener("load", start, { once: true });
else start();
