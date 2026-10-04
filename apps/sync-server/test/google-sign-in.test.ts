import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import worker from "../src/index";

it("starts Google OAuth from either app with shared state cookies and a shared callback", async () => {
  const bindings = {
    ...env,
    GOOGLE_CLIENT_ID: "test-client",
    GOOGLE_CLIENT_SECRET: "test-secret",
  };
  for (const origin of ["http://localhost:5175", "http://localhost:5180"]) {
    const response = await worker.fetch(
      new Request("http://localhost:8792/api/auth/sign-in/social", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "google",
          callbackURL: `${origin}/login-success`,
        }),
      }),
      bindings,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(
      "true",
    );
    expect(response.headers.get("set-cookie")).toContain("workbench");
    const data = (await response.json()) as { url: string };
    const destination = new URL(data.url);
    expect(destination.origin).toBe("https://accounts.google.com");
    expect(destination.searchParams.get("redirect_uri")).toBe(
      "http://localhost:8792/api/auth/callback/google",
    );
    expect(destination.searchParams.get("state")).toBeTruthy();
  }
  const rejected = await worker.fetch(
    new Request("http://localhost:8792/api/auth/sign-in/social", {
      method: "POST",
      headers: {
        Origin: "http://localhost:5175",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        provider: "google",
        callbackURL: "https://untrusted.example/",
      }),
    }),
    bindings,
  );
  expect(rejected.status).toBe(403);
});
