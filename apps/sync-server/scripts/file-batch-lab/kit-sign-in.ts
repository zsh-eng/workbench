/**
 * Agent kit `--before` module: signs in to a lab account that bench.ts
 * seeded (LAB_APP=arctic|spaced, LAB_N), from the app's own origin.
 *
 *   LAB_APP=arctic LAB_N=200 bun run kit clip http://localhost:5502/settings \
 *     --before apps/sync-server/scripts/file-batch-lab/kit-sign-in.ts \
 *     --steps apps/sync-server/scripts/file-batch-lab/kit-download.ts --desktop
 */
import type { Page } from "@playwright/test";

export const LAB_API = process.env.LAB_API ?? "http://localhost:5501";

export default async function signIn({
  page,
  baseURL,
}: {
  page: Page;
  baseURL: string;
}) {
  await page.goto(baseURL);
  const ok = await page.evaluate(
    async ({ api, email }) =>
      (
        await fetch(`${api}/api/auth/sign-in/email`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password: "file-batch-lab-password" }),
        })
      ).ok,
    {
      api: LAB_API,
      email: `lab-${process.env.LAB_APP}-${process.env.LAB_N}@example.test`,
    },
  );
  if (!ok) throw new Error("Sign-in failed; seed the account with bench.ts");
}
