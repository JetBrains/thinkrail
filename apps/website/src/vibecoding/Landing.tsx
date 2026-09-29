import { useEffect } from "react";
import "./styles.css";
import { CallToAction } from "./CallToAction";
import { Capabilities } from "./Capabilities";
import { ChatDemo } from "./ChatDemo";
import { Hero } from "./Hero";
import { Orchestration } from "./Orchestration";
import { Principles } from "./Principles";
import type { Positioning } from "./positioning";
import { SectionDivider } from "./SectionDivider";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { Isolation, SpecFirst } from "./Workflow";

export function Landing({
	heroTitle = "Vibe code without losing control.",
	positioning = "control",
}: {
	heroTitle?: string;
	positioning?: Positioning;
}) {
	useEffect(() => {
		document.documentElement.dataset.landingReady = "true";
	}, []);

	return (
		<div className="min-h-screen bg-background">
			<SiteHeader />
			<main>
				<Hero title={heroTitle} positioning={positioning} />
				<SectionDivider />
				<ChatDemo positioning={positioning} />
				<SectionDivider />
				<Principles positioning={positioning} />
				<SectionDivider />
				<Capabilities positioning={positioning} />
				<SectionDivider />
				<Orchestration />
				<SectionDivider />
				<SpecFirst positioning={positioning} />
				<SectionDivider />
				<Isolation />
				<SectionDivider />
				<CallToAction positioning={positioning} />
			</main>
			<SiteFooter />
		</div>
	);
}
