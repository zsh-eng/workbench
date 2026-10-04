import { test, expect } from "@playwright/test";

const api = "http://localhost:8792";
const google = "https://accounts.google.com/o/oauth2/v2/auth?state=fixture";

for (const variant of ["reader-desktop", "reader-mobile", "spaced"] as const) {
  test(`${variant} signs in directly with Google and keeps failures in the app`, async ({
    page,
    context,
  }) => {
    const spaced = variant === "spaced";
    const origin = spaced ? "http://localhost:5180" : "http://localhost:5175";
    if (variant === "reader-mobile")
      await page.setViewportSize({ width: 390, height: 844 });
    let fail = true;
    const payloads: unknown[] = [];
    const loginVisits: string[] = [];
    page.on("request", (request) => {
      if (
        request.isNavigationRequest() &&
        request.url().startsWith(`${api}/login`)
      )
        loginVisits.push(request.url());
    });
    // Only the external auth result is replaced. Real app buttons and clients run.
    await context.route(`${api}/api/auth/sign-in/social`, async (route) => {
      if (route.request().method() === "OPTIONS") return route.continue();
      payloads.push(route.request().postDataJSON());
      await route.fulfill({
        status: fail ? 503 : 200,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
        },
        json: fail
          ? { message: "Google sign-in unavailable" }
          : { url: google, redirect: true },
      });
    });
    await context.route("https://accounts.google.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "Google sign-in destination",
      }),
    );
    await page.goto(`${origin}${spaced ? "/profile" : "/"}`);
    if (spaced) {
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
    } else {
      await expect(page.getByText("Your library is empty")).toBeVisible({
        timeout: 30_000,
      });
      await page
        .getByRole("button", {
          name:
            variant === "reader-mobile" ? "Open navigation" : "Toggle sidebar",
          exact: true,
        })
        .click();
    }
    const signIn = page.getByRole("button", {
      name: spaced ? "Continue with Google" : "Sign in with Google",
      exact: true,
    });
    await signIn.click();
    await expect(
      page.getByText(
        spaced
          ? "Google sign-in unavailable"
          : "Could not sign in with Google.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(new URL(page.url()).origin).toBe(origin);
    fail = false;
    await signIn.click();
    await expect(page).toHaveURL(google);
    expect(payloads).toHaveLength(2);
    expect(payloads[1]).toMatchObject({
      provider: "google",
      callbackURL: spaced ? `${origin}/login-success` : origin,
    });
    expect(loginVisits).toEqual([]);
  });
}
