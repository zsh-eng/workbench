import type { KitContext } from "../../../../../packages/agent-kit/kit";
import { API, article, phone } from "../phone";
import { publisher } from "../publisher";

/**
 * agent-kit `--before`, with the Arctic stack running (`E2E_API_PORT` names
 * its API): signs up, saves a few older links as the real library has them
 * (most of the newest without a picture), and starts a local publisher whose
 * article page has an og:image. Returns its link as `{link}`, for
 * `save-link.ts`. The publisher answers after 1.5 s, as a slow site does.
 */
export default async function previewAccount({
  page,
  context,
  baseURL,
}: KitContext) {
  // In the page: Playwright's own request cannot keep the session's cookie
  // under Bun, which runs the kit.
  await page.goto(baseURL);
  const ok = await page.evaluate(
    (api) =>
      fetch(`${api}/api/auth/sign-up/email`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: `arctic-${crypto.randomUUID()}@example.test`,
          password: crypto.randomUUID(),
          name: "Test reader",
        }),
      }).then((response) => response.ok),
    API,
  );
  if (!ok) throw new Error("sign-up failed");
  const site = await publisher({ delayMs: 1500 });
  const older = [
    { title: "Harbour towns, revisited", subtitle: "Small ports after the ferries left." },
    { title: "Notes on school lunches", subtitle: "What a canteen knows." },
    { title: "Quiet databases" },
    { title: "Paper maps", subtitle: "Why folding still wins." },
    { title: "A floe at dawn", image: `${site.origin}/cover.svg?tone=1` },
    { title: "Tundra in winter", image: `${site.origin}/cover.svg?tone=2` },
    { title: "Cold storage", image: `${site.origin}/cover.svg?tone=3` },
  ];
  await phone(context.request).push(
    older.flatMap(
      (link, index) =>
        article(`https://example.com/older/${index}`, {
          ...link,
          savedAt: Date.now() - (index + 1) * 3_600_000,
        }).records,
    ),
  );
  return { link: site.story };
}
