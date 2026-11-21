import { expect, test } from "bun:test";
import {
	answerTranscript,
	isPairingChallenge,
	offerTranscript,
	pairingMacInput,
	proofTranscript,
	registerTranscript,
} from "./pairingAuth";

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

test("transcripts are domain-separated so one purpose's signature never verifies as another", () => {
	expect(text(registerTranscript("n"))).toBe("thinkrail/register/v1\nn");
	expect(text(offerTranscript("n", "c", "v=0\r\n"))).toBe("thinkrail/offer/v1\nn\nc\nv=0\r\n");
	expect(text(answerTranscript("c", "v=0"))).toBe("thinkrail/answer/v1\nc\nv=0");
	expect(text(pairingMacInput("k", "c"))).toBe("thinkrail/pair/v1\nk\nc");
	expect(text(proofTranscript("h", "c"))).toBe("thinkrail/proof/v1\nh\nc");
});

test("a pairing challenge is the unpadded base64url of exactly 32 bytes", () => {
	expect(isPairingChallenge("A".repeat(43))).toBe(true);
	expect(isPairingChallenge("A".repeat(42))).toBe(false);
	expect(isPairingChallenge("A".repeat(44))).toBe(false);
	expect(isPairingChallenge(`${"A".repeat(42)}=`)).toBe(false);
	expect(isPairingChallenge(`${"A".repeat(42)}+`)).toBe(false);
});
