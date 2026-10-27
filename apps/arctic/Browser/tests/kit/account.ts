import type { KitContext } from "../../../../../packages/agent-kit/kit";
import { API, addText, article, paragraphs, phone } from "../phone";

/**
 * agent-kit `--before`, with the Arctic stack running (`E2E_API_PORT` names
 * its API): signs up and saves one article, "A floe at dawn", with text.
 */
export default async function account({ page, context, baseURL }: KitContext) {
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
  const floe = article("https://example.com/floe", { title: "A floe at dawn" });
  await phone(context.request).push(floe.records);
  await addText(context.request, floe, paragraphs(12));
  return {};
}
