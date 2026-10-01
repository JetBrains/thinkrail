declare module "@stroncium/procfs/lib/parsers" {
	const parsers: object;
	export default parsers;
}

declare module "@stroncium/procfs/lib/parsers/processMountinfo" {
	const processMountinfo: (source: string) => unknown;
	export default processMountinfo;
}
