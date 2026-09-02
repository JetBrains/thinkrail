export interface LatestOperation {
	begin: () => () => boolean;
}

export function createLatestOperation(): LatestOperation {
	let latest = 0;
	return {
		begin: () => {
			const operation = ++latest;
			return () => operation === latest;
		},
	};
}
