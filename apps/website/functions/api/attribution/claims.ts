import { type AttributionEnvironment, handleCreateClaim } from "../../../src/attribution/server";

type FunctionContext = { request: Request; env: AttributionEnvironment };

export function onRequestPost(context: FunctionContext): Promise<Response> {
	return handleCreateClaim(context.request, context.env);
}
