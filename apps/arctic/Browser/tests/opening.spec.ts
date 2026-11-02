import { expect, test } from "@playwright/test";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import {
  API,
  addText,
  article,
  eventually,
  paragraphs,
  phone,
  signUp,
} from "./phone";

// The production project: the opening policy (../../OPENING.md). This server
// is the app's host, and holds any request open, as a dead network does while
// the device still says it is online.
const port = Number(process.env.E2E_OPENING_PORT ?? 5189);
const origin = `http://localhost:${port}`;
let root = "";
let server: Server | undefined;
let holding = false;
const held: ServerResponse[] = [];
const open = new Set<import("node:net").Socket>();

const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "arctic-opening-"));
  cpSync(join(process.env.ARCTIC_E2E_STATE ?? "", "dist"), root, {
    recursive: true,
  });
  server = createServer((request, response) => {
    if (holding) {
      held.push(response);
      return;
    }
    const path = new URL(request.url ?? "/", origin).pathname;
    let file = join(root, path);
    if (!existsSync(file) || !statSync(file).isFile())
      file = join(root, "index.html");
    response.writeHead(200, {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
    });
    response.end(readFileSync(file));
  });
  server.on("connection", (socket) => {
    open.add(socket);
    socket.on("close", () => open.delete(socket));
  });
  await new Promise<void>((resolve) => server!.listen(port, resolve));
});

test.afterAll(() => {
  for (const socket of open) socket.destroy();
  server?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

test("Arctic opens from what is stored while every request stays open", async ({
  page,
  context,
}) => {
  await signUp(context);
  const floe = article("https://example.com/floe", { title: "A floe at dawn" });
  const tundra = article("https://example.com/tundra", {
    title: "The tundra in winter",
    image: "https://covers.example/tundra.jpg",
  });
  const fjord = article("https://example.com/fjord", {
    title: "A fjord nobody opened",
  });
  await phone(context.request).push([
    ...floe.records,
    ...tundra.records,
    ...fjord.records,
  ]);
  const [, , notStored] = await Promise.all(
    [floe, tundra, fjord].map((item) =>
      addText(context.request, item, `<h2>${item.url}</h2>${paragraphs(12)}`),
    ),
  );
  const hold = () => new Promise<void>(() => {});
  // The app reads ahead, so this text stays out of its reach.
  await context.route(
    `${API}/api/apps/arctic-content/files/${notStored}`,
    hold,
  );

  // A day of use: the worker, the library and two opened texts are stored.
  await page.goto(origin);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(async () => !!(await caches.match("/")));
  for (const title of ["A floe", "The tundra"]) {
    await page.locator(".card-title", { hasText: title }).click();
    await expect(page.locator(".prose")).toContainText("Paragraph 12.");
    await page.goBack();
  }

  // Now nothing answers: not the app's host, the API or a publisher.
  holding = true;
  await context.route(`${API}/**`, hold);
  await context.route("https://covers.example/**", hold);

  const started = Date.now();
  await page.goto(origin, { waitUntil: "commit", timeout: 3000 });
  await expect(page.locator(".card-title").first()).toBeVisible({
    timeout: 3000,
  });
  expect(Date.now() - started).toBeLessThan(3000);
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  // The refresh behind the page is one of the requests still open.
  await eventually(() => held.length).toBeGreaterThan(0);

  // First use: stored text, and an edit that waits for no one.
  await page.locator(".card-title", { hasText: "The tundra" }).click();
  await expect(page.locator(".prose")).toContainText("Paragraph 12.", {
    timeout: 3000,
  });
  await page.getByRole("button", { name: "Archive" }).first().click();
  await expect(
    page.locator(".card-title", { hasText: "The tundra" }),
  ).toBeHidden();

  // An open that comes back later finds the same library, and the edit.
  await page.goto(origin, { waitUntil: "commit", timeout: 3000 });
  await expect(
    page.locator(".card-title", { hasText: "A floe at dawn" }),
  ).toBeVisible({ timeout: 3000 });
  await expect(
    page.locator(".card-title", { hasText: "The tundra" }),
  ).toBeHidden();

  // A text that is not stored has a limit, then a way forward.
  await page.locator(".card-title", { hasText: "A fjord" }).click();
  const retry = page.getByRole("button", { name: "Try again" });
  await expect(retry).toBeVisible({ timeout: 20_000 });
  await context.unrouteAll({ behavior: "ignoreErrors" });
  await retry.click();
  await expect(page.locator(".prose")).toContainText("Paragraph 12.");

  holding = false;
  for (const response of held.splice(0)) response.destroy();
});
