import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import xxhash from "xxhash-wasm";
import worker from "../src/index";
import { credential, signedIn } from "./accounts";

const origin = "http://localhost:8792";
const call = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(origin + path, init), env);

let wallTimeMs = Date.now();
const op = (type: string, id: string, payload: object, table = "operations") => {
  const inner = JSON.stringify([type, id]);
  return {
    key: JSON.stringify([table, inner]),
    value: JSON.stringify({ type, payload, timestamp: 1, id: inner, isDeleted: false }),
  };
};

async function push(auth: Record<string, string>, changes: { key: string; value: string }[]) {
  const scope = await (await call("/api/apps/spaced/sync/v3/state", { headers: auth })).text();
  wallTimeMs = Math.max(wallTimeMs + 1, Date.now());
  return call("/api/apps/spaced/sync/v3/push", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json", "X-Device-ID": "wb-spaced", "X-Sync-Scope": scope },
    body: JSON.stringify({
      changes: changes.map((change, counter) => ({
        ...change,
        isDeleted: false,
        schemaVersion: 1,
        hlc: { wallTimeMs, counter },
      })),
    }),
  });
}

it("wb changes Spaced cards but never review history or an existing schedule", async () => {
  const cookie = await signedIn(call, origin);
  const wb = { Authorization: `Bearer ${await credential(call, cookie, origin)}` };
  const card = (id: string) =>
    op("card", id, { id, due: new Date().toISOString(), stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, reps: 0, lapses: 0, state: "New", last_review: null });

  // The app itself creates a card and reviews it.
  expect((await push({ Cookie: cookie }, [card("c1")])).status).toBe(200);

  // wb suspends and edits it, and creates a new card in a new deck.
  const created = await push(wb, [
    op("cardSuspended", "c1", { cardId: "c1", suspended: "9999-12-31T23:59:59.999Z" }),
    op("cardContent", "c1", { cardId: "c1", front: "Q", back: "A" }),
    op("deck", "d1", { id: "d1", name: "worldview", description: "", deleted: false }),
    card("c2"),
    op("cardContent", "c2", { cardId: "c2", front: "Q2", back: "A2" }),
    op("updateDeckCard", JSON.stringify(["d1", "c2"]), { deckId: "d1", cardId: "c2", present: true }),
  ]);
  expect(created.status).toBe(200);

  const refused = async (changes: { key: string; value: string }[]) => {
    const response = await push(wb, changes);
    expect(response.status).toBe(403);
    return ((await response.json()) as { error: string }).error;
  };
  expect(await refused([card("c1")])).toContain("not change a card's schedule");
  expect(
    await refused([op("reviewLog", "r1", { id: "r1", cardId: "c1" }, "reviewLogOperations")]),
  ).toContain("review history");
  expect(await refused([op("cardMetadata", "c1", { cardId: "c1", noteId: "n", siblingTag: "c1" })])).toContain(
    "only on a card it creates",
  );
  // Sibling metadata rides along with a card it creates.
  expect(
    (
      await push(wb, [
        card("c4"),
        op("cardContent", "c4", { cardId: "c4", front: "Q4", back: "A4" }),
        op("cardMetadata", "c4", { cardId: "c4", noteId: "n1", siblingTag: "c1" }),
      ])
    ).status,
  ).toBe(200);
  const mismatched = op("cardContent", "c1", { cardId: "c1", front: "x", back: "y" });
  expect(
    await refused([{ key: mismatched.key, value: mismatched.value.replace('"cardContent"', '"cardDeleted"') }]),
  ).toContain("doesn't match its key");

  // Near misses that every Spaced client would fail to decode.
  const stolen = card("c3");
  expect(
    await refused([{ key: stolen.key, value: stolen.value.replace('"id":"c3","due"', '"id":"c1","due"') }]),
  ).toContain("doesn't match its key");
  const spaced = op("cardContent", "c1", { cardId: "c1", front: "x", back: "y" });
  expect(
    await refused([{ key: spaced.key.replace('[\\"cardContent\\",', '[\\"cardContent\\", '), value: spaced.value }]),
  ).toContain("Spaced's form");
  expect(
    await refused([{ key: JSON.stringify(["operations", JSON.stringify(["cardContent", "c1"]), "x"]), value: spaced.value }]),
  ).toContain("not a Spaced operation");
  expect(
    await refused([op("updateDeckCard", JSON.stringify(["d1", "c2"]), { deckId: "d1", cardId: "c2", present: false })]),
  ).toContain("doesn't match its key");

  // The browser session is unaffected by the CLI rule.
  expect((await push({ Cookie: cookie }, [card("c1")])).status).toBe(200);
});

it("wb uploads images for Spaced cards, and nothing else", async () => {
  const cookie = await signedIn(call, origin);
  const wb = { Authorization: `Bearer ${await credential(call, cookie, origin)}` };
  const hash = await xxhash();
  const put = (bytes: Uint8Array, type: string, id = `xxh64:${hash.h64Raw(bytes).toString(16).padStart(16, "0")}`) =>
    call(`/api/apps/spaced/files/${id}`, { method: "PUT", headers: { ...wb, "Content-Type": type }, body: bytes });

  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const stored = await put(png, "image/png");
  expect(stored.status).toBe(200);
  const { id } = (await stored.json()) as { id: string };
  const served = await call(`/api/apps/spaced/files/${id}`, { headers: { Cookie: cookie } });
  expect(served.headers.get("Content-Type")).toBe("image/png");
  expect(new Uint8Array(await served.arrayBuffer())).toEqual(png);

  const refused = async (response: Response) => {
    expect(response.status).toBe(403);
    return ((await response.json()) as { error: string }).error;
  };
  const page = new TextEncoder().encode("<script>alert(1)</script>");
  expect(await refused(await put(page, "text/html"))).toContain("PNG, JPEG, WebP, GIF or AVIF");
  expect(await refused(await put(page, "image/svg+xml"))).toContain("PNG, JPEG, WebP, GIF or AVIF");
  // The files route still checks the hash.
  expect((await put(png, "image/png", "xxh64:0000000000000000")).status).toBe(400);
  // Other apps' files stay closed to the CLI.
  expect(
    (await call(`/api/apps/reader/files/${id}`, { method: "PUT", headers: { ...wb, "Content-Type": "image/png" }, body: png }))
      .status,
  ).toBe(403);
});
