declare module "@stroncium/procfs/lib/parsers.js" {
	const parsers: object;
	export default parsers;
}

declare module "@stroncium/procfs/lib/parsers/processMountinfo.js" {
	const processMountinfo: (source: string) => unknown;
	export default processMountinfo;
}
