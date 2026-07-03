/**
 * How long a send (prompt/steer/followUp) may run before the wire acks it as ACCEPTED. pi's send methods
 * resolve only when the whole turn ends — but a turn can outlive any client request timeout (an
 * `ask_user_question` turn blocks until the user answers; long tool rounds are routine), so awaiting
 * completion would time the request out client-side and surface a phantom "request timed out" error over
 * a perfectly healthy turn. An immediate rejection (bad model, missing API key, malformed send) still
 * lands well inside the window; a fault after the ack reaches the client through the event stream
 * (`agent_end` / a message's `stopReason: "error"`), which the chat already renders as an error turn.
 */
export const SEND_ACK_MS = 10_000;

/**
 * Resolve when `run` is *accepted*: a rejection inside the window rethrows (→ an error WS response the
 * client surfaces); a run still going at the window is acked as ok, and any later rejection is swallowed
 * here because it is already reported through the session's event stream.
 */
export async function ackSend(run: Promise<void>, windowMs: number = SEND_ACK_MS): Promise<void> {
	let acked = false;
	const guarded = run.catch((err) => {
		if (!acked) throw err;
	});
	await Promise.race([guarded, new Promise<void>((resolve) => setTimeout(resolve, windowMs))]);
	acked = true;
}
