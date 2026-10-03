import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import shared from "../src/index";

it("keeps a closed migration target inaccessible except for health", async () => {
  const bindings = { ...env, MIGRATION_MODE: "closed" as const };
  for (const path of [
    "/login",
    "/api/me",
    "/api/auth/sign-in/email",
    "/api/apps/reader/sync/v3/state",
  ]) {
    expect(
      (
        await shared.fetch(
          new Request(`http://localhost:8792${path}`),
          bindings,
        )
      ).status,
    ).toBe(503);
  }
  expect(
    (await shared.fetch(new Request("http://localhost:8792/health"), bindings))
      .status,
  ).toBe(200);
});
it("shows only configured providers and hides local registration in production", async () => {
  const bindings = {
    ...env,
    LOCAL_DEVELOPMENT: "false",
    GOOGLE_CLIENT_ID: "test-client",
    GOOGLE_CLIENT_SECRET: "test-secret",
  };
  const response = await shared.fetch(
    new Request("http://localhost:8792/login?returnTo=http://localhost:5180"),
    bindings,
  );
  const html = await response.text();
  expect(html).toContain("Continue with Google");
  expect(html).not.toContain("Continue with GitHub");
  expect(html).not.toContain("Create local account");
});
