import { expect, test } from "vitest";
import { findSymbols, symbolMatchId } from "../../src/shared/symbol-matches";
import type { SymbolMatch } from "../../src/shared/symbols";
function symbol(name: string, scope?: string): SymbolMatch {
  return { name, scope, kind: "function", path: "file.ts", line: 1 };
}
test("symbol ranking prefers exact names, supports fuzzy scopes, and uses smart case", () => {
  const symbols = [
    symbol("getUserSession", "Session"),
    symbol("getUser"),
    symbol("GETUSER"),
    symbol("read", "Session"),
  ];
  expect(findSymbols(symbols, "getUser").map((s) => s.name)).toEqual(["getUser", "getUserSession"]);
  expect(findSymbols(symbols, "getuser")[0]?.name).toBe("getUser");
  expect(findSymbols(symbols, "gussn").map((s) => s.name)).toEqual(["getUserSession"]);
  expect(findSymbols(symbols, "Session.read").map((s) => s.name)).toEqual(["read"]);
  expect(findSymbols(symbols, "unrelated")).toEqual([]);
});
test("symbol results remain bounded and overload locations have separate identities", () => {
  const many = Array.from({ length: 20_000 }, (_, i) => ({ ...symbol(`item${i}`), line: i + 1 }));
  expect(findSymbols(many, "")).toHaveLength(100);
  expect(findSymbols(many, "item19999")[0]?.line).toBe(20_000);
  expect(symbolMatchId(many[0]!)).not.toBe(symbolMatchId({ ...many[0]!, column: 2 }));
});

test("nearby symbols are ranked before the result limit, while typed names keep priority", () => {
  const many = Array.from({ length: 20_000 }, (_, i) => ({ ...symbol(`item${i}`), line: i + 1 }));
  const results = findSymbols(many, "", 100, { line: 19_500, column: 1 });
  expect(results).toHaveLength(100);
  expect(results[0]?.line).toBe(19_500);
  expect(findSymbols(many, "item0", 100, { line: 19_500, column: 1 })[0]?.name).toBe("item0");
  expect(
    findSymbols(
      [
        { ...symbol("left"), line: 8, column: 2 },
        { ...symbol("right"), line: 8, column: 20 },
      ],
      "",
      100,
      { line: 8, column: 18 },
    )[0]?.name,
  ).toBe("right");
});
