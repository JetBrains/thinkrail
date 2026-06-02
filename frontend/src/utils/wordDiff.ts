export type DiffSegment =
  | { kind: "equal"; text: string }
  | { kind: "added"; text: string }
  | { kind: "removed"; text: string };

/** Token-level diff using whitespace boundaries. Preserves spaces inside
 *  segments so concatenating equal+removed yields oldStr and equal+added
 *  yields newStr. LCS-based, O(n*m) in the number of tokens. */
export function wordDiff(oldStr: string, newStr: string): DiffSegment[] {
  if (oldStr === newStr) {
    return oldStr ? [{ kind: "equal", text: oldStr }] : [];
  }
  const a = tokenize(oldStr);
  const b = tokenize(newStr);
  const lcs = buildLcs(a, b);
  const segments: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      pushSeg(segments, "equal", a[i]);
      i++;
      j++;
    } else if (i < a.length && (j >= b.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
      pushSeg(segments, "removed", a[i]);
      i++;
    } else {
      pushSeg(segments, "added", b[j]);
      j++;
    }
  }
  return segments;
}

function tokenize(s: string): string[] {
  const out: string[] = [];
  const re = /(\s+|[^\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push(m[0]);
  return out;
}

function buildLcs(a: string[], b: string[]): number[][] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

function pushSeg(segs: DiffSegment[], kind: DiffSegment["kind"], text: string): void {
  const last = segs[segs.length - 1];
  if (last && last.kind === kind) last.text += text;
  else segs.push({ kind, text });
}
