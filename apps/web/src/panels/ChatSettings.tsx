import { RiCheckLine as Check } from "@remixicon/react";
import type { AppConfigUpdate, ComposerGrowthLimit } from "@thinkrail/contracts";
import type { ChatMessageOrder } from "@/chat/messageOrder";
import { cn } from "@/lib";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";

interface RadioChoice<T extends string> {
	id: T;
	label: string;
	hint: string;
	description: string;
	testId: string;
}

const MESSAGE_ORDER_CHOICES: RadioChoice<ChatMessageOrder>[] = [
	{
		id: "oldest-first",
		label: "Oldest first",
		hint: "Default",
		description: "Shows the earliest request at the top and the latest work at the bottom.",
		testId: "chat-order-oldest-first",
	},
	{
		id: "newest-first",
		label: "Newest first",
		hint: "Latest at top",
		description:
			"Shows the newest item first inside the latest request-and-answer group, followed by older groups.",
		testId: "chat-order-newest-first",
	},
];

const GROWTH_CHOICES: RadioChoice<ComposerGrowthLimit>[] = [
	{
		id: "compact",
		label: "Compact",
		hint: "6 lines",
		description: "Keeps long drafts to six visual lines before scrolling.",
		testId: "composer-growth-compact",
	},
	{
		id: "roomy",
		label: "Roomy",
		hint: "10 lines",
		description: "Keeps long drafts to ten visual lines before scrolling.",
		testId: "composer-growth-roomy",
	},
	{
		id: "half-chat",
		label: "Half chat",
		hint: "Default",
		description: "Uses up to half of the mounted chat panel before scrolling.",
		testId: "composer-growth-half-chat",
	},
];

function RadioCards<T extends string>({
	name,
	label,
	choices,
	value,
	onSelect,
}: {
	name: string;
	label: string;
	choices: RadioChoice<T>[];
	value: T;
	onSelect: (value: T) => void;
}) {
	return (
		<div role="radiogroup" aria-label={label} className="flex flex-col gap-4">
			{choices.map((choice) => {
				const active = choice.id === value;
				return (
					<label
						key={choice.id}
						data-testid={choice.testId}
						data-active={active}
						className={cn(
							"flex cursor-pointer items-center gap-8 rounded-[var(--radius-sm)] border px-12 py-8 text-left transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
							active
								? "border-primary-muted bg-clip-padding bg-primary-subtle"
								: "border-border-default hover:bg-control-bg-hovered",
						)}
					>
						<input
							type="radio"
							name={name}
							value={choice.id}
							checked={active}
							onChange={() => onSelect(choice.id)}
							className="sr-only"
						/>
						<span className="min-w-0 flex-1">
							<span className="flex items-center gap-4 tr-title-compact text-text-default">
								{choice.label}
								<span className="text-text-muted tr-text-metadata">{choice.hint}</span>
							</span>
							<span className="block text-text-muted tr-text-metadata">{choice.description}</span>
						</span>
						{active ? <Check className="size-16 shrink-0 text-primary" /> : null}
					</label>
				);
			})}
		</div>
	);
}

function saveSetting(config: AppConfigUpdate, errorMessage: string): void {
	getTransport()
		.request("settings.update", { config })
		.catch(() => toast.error(errorMessage));
}

export function ChatSettings() {
	const messageOrder = useAppStore((state) => state.chatMessageOrder);
	const growthLimit = useAppStore((state) => state.composerGrowthLimit);
	const setChatMessageOrder = useAppStore((state) => state.setChatMessageOrder);

	const selectMessageOrder = (chatMessageOrder: ChatMessageOrder) => {
		if (chatMessageOrder === messageOrder) return;
		setChatMessageOrder(chatMessageOrder);
	};

	const selectGrowthLimit = (composerGrowthLimit: ComposerGrowthLimit) => {
		if (composerGrowthLimit === growthLimit) return;
		saveSetting({ composerGrowthLimit }, "Couldn't change message box growth");
	};

	return (
		<section data-testid="settings-chat" className="flex flex-col gap-16">
			<div className="flex flex-col gap-8">
				<div className="flex flex-col gap-4">
					<h3 className="tr-title-section text-text-default">Message order</h3>
					<p className="text-text-muted tr-text-metadata">
						Choose whether the oldest or newest work appears first. The message box stays at the
						bottom. Your choice is saved in this client for this host only.
					</p>
				</div>
				<RadioCards
					name="chat-message-order"
					label="Chat message order"
					choices={MESSAGE_ORDER_CHOICES}
					value={messageOrder}
					onSelect={selectMessageOrder}
				/>
			</div>

			<div className="flex flex-col gap-8 border-border-default border-t pt-16">
				<div className="flex flex-col gap-4">
					<h3 className="tr-title-section text-text-default">Message box growth</h3>
					<p className="text-text-muted tr-text-metadata">
						Choose how tall long drafts may grow before the message box scrolls. Your choice is
						saved on the host and follows you across devices.
					</p>
				</div>
				<RadioCards
					name="composer-growth-limit"
					label="Message box growth limit"
					choices={GROWTH_CHOICES}
					value={growthLimit}
					onSelect={selectGrowthLimit}
				/>
			</div>
		</section>
	);
}
