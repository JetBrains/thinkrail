import { expect, test } from "bun:test";
import {
	answerTranscript,
	offerTranscript,
	pairingMacInput,
	registerTranscript,
} from "./pairingAuth";

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

test("transcripts are domain-separated so one purpose's signature never verifies as another", () => {
	expect(text(registerTranscript("n"))).toBe("thinkrail/register/v1\nn");
	expect(text(offerTranscript("n", "c", "v=0\r\n"))).toBe("thinkrail/offer/v1\nn\nc\nv=0\r\n");
	expect(text(answerTranscript("c", "v=0"))).toBe("thinkrail/answer/v1\nc\nv=0");
	expect(text(pairingMacInput("k", "c"))).toBe("thinkrail/pair/v1\nk\nc");
});
