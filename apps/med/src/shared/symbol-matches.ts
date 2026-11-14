import type { SymbolMatch } from "./symbols";

export function symbolMatchId(symbol: SymbolMatch): string {
  return JSON.stringify([symbol.path, symbol.line, symbol.column, symbol.name, symbol.kind]);
}

/** A symbol with the forms of its name that ranking compares. A list that
 * many queries rank keeps these, so a query makes no new strings. */
export interface SymbolKey {
  match: SymbolMatch;
  lowerName: string;
  /** `scope.name`, or the name. */
  scoped: string;
  lowerScoped: string;
}

export function symbolKeys(matches: readonly SymbolMatch[]): SymbolKey[] {
  return matches.map((match) => {
    const scoped = match.scope ? `${match.scope}.${match.name}` : match.name;
    return {
      match,
      lowerName: match.name.toLowerCase(),
      scoped,
      lowerScoped: scoped.toLowerCase(),
    };
  });
}

/** `query` is trimmed; with an upper-case letter it matches case. `characters`
 * are its code points. */
function scoreSymbol(
  key: SymbolKey,
  query: string,
  characters: readonly string[],
  smartCase: boolean,
): number {
  if (!query) return 0;
  const name = smartCase ? key.match.name : key.lowerName;
  if (name === query) return 10_000;
  if (name.startsWith(query)) return 8_000 - name.length;
  const direct = name.indexOf(query);
  if (direct >= 0) return 6_000 - direct - name.length;
  const value = smartCase ? key.scoped : key.lowerScoped;
  if (value.includes(query)) return 4_000 - value.length;
  let cursor = 0;
  let gaps = 0;
  for (const character of characters) {
    const next = value.indexOf(character, cursor);
    if (next < 0) return -Infinity;
    gaps += next - cursor;
    cursor = next + 1;
  }
  return 2_000 - gaps - value.length;
}

/** Bound both sorting work and mounted rows, even for generated files with many declarations. */
export function findSymbols(
  matches: readonly SymbolMatch[],
  query: string,
  limit = 100,
  near?: { line: number; column: number },
): SymbolMatch[] {
  return findSymbolKeys(symbolKeys(matches), query, limit, near);
}

/** `findSymbols` over keys made once, for a list that many queries rank. */
export function findSymbolKeys(
  keys: readonly SymbolKey[],
  query: string,
  limit = 100,
  near?: { line: number; column: number },
): SymbolMatch[] {
  const text = query.trim();
  const characters = [...text];
  const smartCase = text !== text.toLowerCase();
  type Candidate = { match: SymbolMatch; score: number };
  // Above zero when a symbol with this score ranks after `other`.
  const after = (score: number, match: SymbolMatch, other: Candidate) =>
    other.score - score ||
    (near
      ? Math.abs(match.line - near.line) - Math.abs(other.match.line - near.line) ||
        Math.abs((match.column ?? 1) - near.column) -
          Math.abs((other.match.column ?? 1) - near.column)
      : 0);
  const best: Candidate[] = [];
  for (const key of keys) {
    const score = scoreSymbol(key, text, characters, smartCase);
    if (
      score === -Infinity ||
      (best.length === limit && after(score, key.match, best[limit - 1]!) >= 0)
    )
      continue;
    let index = best.findIndex((item) => after(score, key.match, item) < 0);
    if (index < 0) index = best.length;
    best.splice(index, 0, { match: key.match, score });
    if (best.length > limit) best.pop();
  }
  return best.map(({ match }) => match);
}
