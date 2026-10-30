import { StaleComposerNotice } from "../../../../../packages/resource-renderers/src/renderers/StaleComposerNotice";

const CELLS = ["import pandas as pd", 'df = pd.read_csv("runs.csv")', "df.describe()"];

export default function NotebookEnd() {
	return (
		<div className="flex w-full flex-col gap-8">
			{CELLS.map((cell) => (
				<section key={cell}>
					<pre className="tr-code-text text-text-default">{cell}</pre>
				</section>
			))}
			<StaleComposerNotice visible />
		</div>
	);
}
