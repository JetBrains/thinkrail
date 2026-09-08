import { useEffect } from "react";
import "./styles.css";
import { CallToAction } from "./CallToAction";
import { Capabilities } from "./Capabilities";
import { ChatDemo } from "./ChatDemo";
import { Hero } from "./Hero";
import { Orchestration } from "./Orchestration";
import { Principles } from "./Principles";
import { SectionDivider } from "./SectionDivider";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { Isolation, SpecFirst } from "./Workflow";

export function Landing({
	heroTitle = "Vibe code without losing control.",
}: {
	heroTitle?: string;
}) {
	useEffect(() => {
		document.documentElement.dataset.landingReady = "true";
	}, []);

	return (
		<div className="min-h-screen bg-background">
			<SiteHeader />
			<main>
				<Hero title={heroTitle} />
				<SectionDivider />
				<ChatDemo />
				<SectionDivider />
				<Principles />
				<SectionDivider />
				<Capabilities />
				<SectionDivider />
				<Orchestration />
				<SectionDivider />
				<SpecFirst />
				<SectionDivider />
				<Isolation />
				<SectionDivider />
				<CallToAction />
			</main>
			<SiteFooter />
		</div>
	);
}
