type SendWatched = (keys: string[]) => Promise<unknown>;

export const createChannelDemand = () => {
	const counts = new Map<string, number>();
	let send: SendWatched | undefined;
	let sent: string | undefined;
	let scheduled = false;

	const flush = () => {
		scheduled = false;
		if (!send) return;
		const keys = [...counts.keys()].sort();
		const signature = JSON.stringify(keys);
		if (signature === sent) return;
		sent = signature;
		send(keys).catch(() => {
			if (sent === signature) sent = undefined;
		});
	};

	const schedule = () => {
		if (scheduled) return;
		scheduled = true;
		queueMicrotask(flush);
	};

	return {
		retain(key: string) {
			counts.set(key, (counts.get(key) ?? 0) + 1);
			schedule();
			let released = false;
			return () => {
				if (released) return;
				released = true;
				const left = (counts.get(key) ?? 1) - 1;
				if (left > 0) counts.set(key, left);
				else counts.delete(key);
				schedule();
			};
		},
		connect(next: SendWatched) {
			send = next;
			sent = undefined;
			flush();
		},
		disconnect() {
			send = undefined;
			sent = undefined;
		},
	};
};

export const channelDemand = createChannelDemand();
