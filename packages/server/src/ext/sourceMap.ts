const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DIGIT = new Map([...BASE64].map((char, index) => [char, index]));

const decodeSegment = (segment: string) => {
	const values: number[] = [];
	let value = 0;
	let shift = 0;
	for (const char of segment) {
		const digit = DIGIT.get(char);
		if (digit === undefined) throw new Error(`bad source map character "${char}"`);
		value += (digit & 31) << shift;
		if (digit & 32) {
			shift += 5;
			continue;
		}
		values.push(value & 1 ? -(value >>> 1) : value >>> 1);
		value = 0;
		shift = 0;
	}
	return values;
};

const encodeValue = (value: number) => {
	let rest = value < 0 ? (-value << 1) | 1 : value << 1;
	let out = "";
	do {
		let digit = rest & 31;
		rest >>>= 5;
		if (rest > 0) digit |= 32;
		out += BASE64[digit];
	} while (rest > 0);
	return out;
};

interface RawMap {
	version: number;
	sources: string[];
	sourcesContent?: (string | null)[];
	mappings: string;
	names?: string[];
	[key: string]: unknown;
}

const isRawMap = (value: unknown): value is RawMap =>
	typeof value === "object" &&
	value !== null &&
	"sources" in value &&
	Array.isArray(value.sources) &&
	"mappings" in value &&
	typeof value.mappings === "string";

const filterMappings = (mappings: string, keep: ReadonlyMap<number, number>) => {
	const abs = [0, 0, 0, 0];
	const out = [0, 0, 0, 0];
	return mappings
		.split(";")
		.map((line) => {
			let column = 0;
			let outColumn = 0;
			let mapped = false;
			const segments: string[] = [];
			const unmapped = () => {
				if (!mapped) return;
				segments.push(encodeValue(column - outColumn));
				outColumn = column;
				mapped = false;
			};
			for (const raw of line.split(",")) {
				if (raw === "") continue;
				const [generated = 0, ...fields] = decodeSegment(raw);
				column += generated;
				fields.forEach((delta, index) => {
					abs[index] = (abs[index] ?? 0) + delta;
				});
				const source = fields.length === 0 ? undefined : keep.get(abs[0] ?? -1);
				if (source === undefined) {
					unmapped();
					continue;
				}
				mapped = true;
				const values = [
					source,
					abs[1] ?? 0,
					abs[2] ?? 0,
					...(fields.length > 3 ? [abs[3] ?? 0] : []),
				];
				const encoded = [encodeValue(column - outColumn)];
				values.forEach((value, index) => {
					encoded.push(encodeValue(value - (out[index] ?? 0)));
					out[index] = value;
				});
				outColumn = column;
				segments.push(encoded.join(""));
			}
			return segments.join(",");
		})
		.join(";");
};

export const ownSourcesMap = (json: string, isOwn: (source: string) => boolean) => {
	const parsed: unknown = JSON.parse(json);
	if (!isRawMap(parsed)) throw new Error("not a source map");
	const keep = new Map<number, number>();
	const sources: string[] = [];
	const contents: (string | null)[] = [];
	parsed.sources.forEach((source, index) => {
		if (!isOwn(source)) return;
		keep.set(index, sources.length);
		sources.push(source);
		contents.push(parsed.sourcesContent?.[index] ?? null);
	});
	return JSON.stringify({
		version: parsed.version,
		sources,
		sourcesContent: contents,
		mappings: filterMappings(parsed.mappings, keep),
		names: parsed.names ?? [],
	});
};
