import { RiGitMergeLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Switch } from "@thinkrail/ui/switch";
import { useState } from "react";

export default function Busy() {
	const t = useT();
	const branch = "feature/login";
	const [deleteBranch, setDeleteBranch] = useState(true);
	const [busy, setBusy] = useState(false);
	const merge = () => {
		setBusy(true);
		setTimeout(() => setBusy(false), 1500);
	};
	return (
		<div className="flex w-full max-w-[28rem] flex-col gap-12">
			<div className="flex items-center justify-between gap-12">
				<span className="tr-text-ui text-text-default">
					{t("panels.mergePr.deleteBranch", { branch })}
				</span>
				<Switch
					checked={deleteBranch}
					label={t("panels.mergePr.deleteBranch", { branch })}
					testId="merge-pr-delete-branch"
					disabled={busy}
					onCheckedChange={setDeleteBranch}
				/>
			</div>
			<div className="flex justify-end">
				<Button iconLeft={RiGitMergeLine} loading={busy} onClick={merge}>
					{t("panels.mergePr.method.squash")}
				</Button>
			</div>
		</div>
	);
}
