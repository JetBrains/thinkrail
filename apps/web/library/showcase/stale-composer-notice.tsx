import { StaleComposerNotice } from "../../../../packages/resource-renderers/src/renderers/StaleComposerNotice";
import type { PlaygroundValues, Showcase } from "./types";

function PlaygroundPreview({ values }: { values: PlaygroundValues }) {
	return <StaleComposerNotice visible={values.visible === true} />;
}

export const staleComposerNoticeShowcase: Showcase = {
	sections: [],
	playground: {
		controls: [{ kind: "flag", name: "visible" }],
		initial: { visible: true },
		Preview: PlaygroundPreview,
		code: (values) => `<StaleComposerNotice visible={${values.visible === true}} />`,
	},
};
