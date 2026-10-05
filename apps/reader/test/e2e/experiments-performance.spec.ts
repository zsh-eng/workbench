import { test, expect } from "./helpers/fixtures";

// Opt-in, fixed-duration CPU sample; ordinary E2E runs test behavior separately.
// READER_EXPERIMENTS_PROFILE=1 bun run test:e2e experiments-performance --workers=1
for (let run = 1; run <= 3; run += 1) {
  test(`profile offscreen experiments ${run}`, async ({
    page,
    context,
  }, testInfo) => {
    test.skip(
      !process.env.READER_EXPERIMENTS_PROFILE,
      "Opt-in performance trace",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/debug/experiments");
    const lumen = page.locator("#plate-lumen");
    await lumen.scrollIntoViewIfNeeded();
    const start = lumen.getByRole("button", { name: "Start pacer" });
    await expect(start).toBeVisible();
    await start.click();
    const reader = lumen.locator('[aria-label^="Moby"]');
    await expect
      .poll(() => reader.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(5);
    await page.locator("#plate-clock").scrollIntoViewIfNeeded();
    await expect(page.locator("#plate-clock svg").first()).toBeVisible();
    const client = await context.newCDPSession(page);
    await client.send("Performance.enable");
    await client.send("Tracing.start", {
      categories: "devtools.timeline",
      transferMode: "ReturnAsStream",
    });
    const before = await client.send("Performance.getMetrics");
    // This is the measured idle window, not an application-readiness delay.
    await page.waitForTimeout(2000);
    const after = await client.send("Performance.getMetrics");
    const completed = new Promise<{ stream: string }>((resolve) =>
      client.once("Tracing.tracingComplete", resolve),
    );
    await client.send("Tracing.end");
    const { stream } = await completed;
    let trace = "";
    for (;;) {
      const chunk = await client.send("IO.read", { handle: stream });
      trace += chunk.data;
      if (chunk.eof) break;
    }
    await client.send("IO.close", { handle: stream });
    const metric = (name: string) =>
      1000 *
      (after.metrics.find((m) => m.name === name)!.value -
        before.metrics.find((m) => m.name === name)!.value);
    const result = {
      taskMs: metric("TaskDuration"),
      scriptMs: metric("ScriptDuration"),
      layoutMs: metric("LayoutDuration"),
    };
    console.log("EXPERIMENTS_PROFILE", JSON.stringify(result));
    await testInfo.attach("offscreen-cpu.json", {
      body: JSON.stringify(result),
      contentType: "application/json",
    });
    await testInfo.attach("offscreen-trace.json", {
      body: trace,
      contentType: "application/json",
    });
    await client.detach();
  });
}
