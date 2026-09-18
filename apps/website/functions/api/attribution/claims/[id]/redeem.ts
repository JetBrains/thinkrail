import {
	type AttributionEnvironment,
	handleRedeemClaim,
} from "../../../../../src/attribution/server";

type FunctionContext = {
	request: Request;
	env: AttributionEnvironment;
	params: { id: string | string[] };
};

export function onRequestPost(context: FunctionContext): Promise<Response> {
	const claimId = context.params.id;
	return handleRedeemClaim(
		context.request,
		context.env,
		typeof claimId === "string" ? claimId : "",
	);
}
