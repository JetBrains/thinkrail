import type { ComponentType } from "react";

export type PlaygroundValues = Record<string, string | boolean>;

export type PlaygroundControl =
	| { kind: "choice"; name: string; options: readonly string[] }
	| { kind: "flag"; name: string };

export interface PlaygroundConfig {
	controls: readonly PlaygroundControl[];
	initial: PlaygroundValues;
	Preview: ComponentType<{ values: PlaygroundValues }>;
	code: (values: PlaygroundValues) => string;
}

export interface ShowcaseSection {
	id: string;
	Render: ComponentType;
}

export interface Showcase {
	sections: readonly ShowcaseSection[];
	playground?: PlaygroundConfig;
}
