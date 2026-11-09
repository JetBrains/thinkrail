import { useT } from "@thinkrail/locales/react";
import type { PairState } from "./App";
import { Screen } from "./layout";
import { PairActions } from "./PairForm";
import { PairSteps } from "./Welcome";

/** Adding a computer, pushed from the Computers tab: the pairing steps, then scan or paste a link. */
export function AddComputerScreen({
	pair,
	onPair,
	backLabel,
	onBack,
}: {
	pair: PairState;
	onPair: (link: string) => Promise<boolean>;
	backLabel: string;
	onBack: () => void;
}) {
	const t = useT();
	return (
		<Screen title={t("mobile.devices.add")} back={{ label: backLabel, onBack }}>
			<div data-testid="add-computer" className="flex flex-col gap-24 px-16 py-24">
				<PairSteps />
				<PairActions pair={pair} onPair={onPair} />
			</div>
		</Screen>
	);
}
