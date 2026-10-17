import type { SymbolMatch } from "./symbols";

export function symbolMatchId(symbol: SymbolMatch): string {
  return JSON.stringify([symbol.path, symbol.line, symbol.column, symbol.name, symbol.kind]);
}

function scoreSymbol(symbol: SymbolMatch, query: string): number {
  if (!query) return 0;
  const smartCase = query !== query.toLowerCase();
  const name = smartCase ? symbol.name : symbol.name.toLowerCase();
  if (name === query) return 10_000;
  if (name.startsWith(query)) return 8_000 - name.length;
  const direct = name.indexOf(query);
  if (direct >= 0) return 6_000 - direct - name.length;
  const scoped = symbol.scope ? `${symbol.scope}.${symbol.name}` : symbol.name;
  const value = smartCase ? scoped : scoped.toLowerCase();
  if (value.includes(query)) return 4_000 - value.length;
  let cursor = 0;
  let gaps = 0;
  for (const character of query) {
    const next = value.indexOf(character, cursor);
    if (next < 0) return -Infinity;
    gaps += next - cursor;
    cursor = next + 1;
  }
  return 2_000 - gaps - value.length;
}

/** Bound both sorting work and mounted rows, even for generated files with many declarations. */
export function findSymbols(
  matches: SymbolMatch[],
  query: string,
  limit = 100,
  near?: { line: number; column: number },
): SymbolMatch[] {
  const text = query.trim();
  type Candidate = { match: SymbolMatch; score: number };
  const compare = (a: Candidate, b: Candidate) =>
    b.score - a.score ||
    (near
      ? Math.abs(a.match.line - near.line) - Math.abs(b.match.line - near.line) ||
        Math.abs((a.match.column ?? 1) - near.column) -
          Math.abs((b.match.column ?? 1) - near.column)
      : 0);
  const best: Candidate[] = [];
  for (const match of matches) {
    const score = scoreSymbol(match, text);
    const candidate = { match, score };
    if (score === -Infinity || (best.length === limit && compare(candidate, best[limit - 1]!) >= 0))
      continue;
    let index = best.findIndex((item) => compare(candidate, item) < 0);
    if (index < 0) index = best.length;
    best.splice(index, 0, { match, score });
    if (best.length > limit) best.pop();
  }
  return best.map(({ match }) => match);
}
