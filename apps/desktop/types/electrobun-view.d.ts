type RpcShape = {
	bun: { messages: Record<string, unknown> };
};

type MessageSenders<T extends RpcShape> = {
	[K in keyof T["bun"]["messages"]]: (payload: T["bun"]["messages"][K]) => void;
};

interface DefinedRpc<T extends RpcShape> {
	readonly type: T;
}

export class Electroview<T extends RpcShape = RpcShape> {
	static defineRPC<T extends RpcShape>(definition: {
		maxRequestTime: number;
		handlers: { requests: Record<string, never>; messages: Record<string, never> };
	}): DefinedRpc<T>;
	constructor(options: { rpc: DefinedRpc<T> });
	readonly rpc?: { readonly send: MessageSenders<T> };
}

declare const Electrobun: {
	Electroview: typeof Electroview;
};

export default Electrobun;
