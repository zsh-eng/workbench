import type { KitContext } from "../../../../../packages/agent-kit/kit";
import { LAB_API } from "../../scripts/first-sync-lab";

/**
 * agent-kit `--before`: signs in to an account on the first-sync lab's API
 * (LAB_EMAIL and LAB_PASSWORD), from the app's page, as its sign-in does.
 * With `scripts/local-library.ts` that account can hold a real library.
 */
export default async function labAccount({ page, baseURL }: KitContext) {
  await page.goto(baseURL);
  const status = await page.evaluate(
    async ({ api, email, password }) =>
      (
        await fetch(`${api}/api/auth/sign-in/email`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        })
      ).status,
    {
      api: LAB_API,
      email: process.env.LAB_EMAIL,
      password: process.env.LAB_PASSWORD,
    },
  );
  if (status !== 200) throw new Error(`Sign-in failed: ${status}`);
  return {};
}
