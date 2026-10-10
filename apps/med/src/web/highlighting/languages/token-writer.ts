import type { TokenizeResult } from "@twinkleplop/core";

/** A fixed table of TextMate scope stacks. `kind` returns a scope's index. */
export function scopeTable() {
  const types: string[] = [];
  const index = new Map<string, number>();
  const kind = (scope: string) => {
    let k = index.get(scope);
    if (k === undefined) {
      k = types.push(scope) - 1;
      index.set(scope, k);
    }
    return k;
  };
  return { types, kind };
}

/** Collect [kind, start, end] triples; adjacent tokens of one kind merge. */
export function createWriter(length: number, types: string[]) {
  let tokens = new Uint32Array(Math.min(Math.max(length, 64), 1 << 20));
  let n = 0;
  return {
    push(kind: number, start: number, end: number) {
      if (end <= start) return;
      if (n && tokens[n - 3] === kind && tokens[n - 1] === start) {
        tokens[n - 1] = end;
        return;
      }
      if (n + 3 > tokens.length) {
        const grown = new Uint32Array(tokens.length * 2);
        grown.set(tokens);
        tokens = grown;
      }
      tokens[n++] = kind;
      tokens[n++] = start;
      tokens[n++] = end;
    },
    result(): TokenizeResult {
      return { tokens: tokens.slice(0, n), token_types: types };
    },
  };
}
