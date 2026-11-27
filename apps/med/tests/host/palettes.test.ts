import { afterEach, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPalettes, parseItemsText, parsePalette } from "../../src/host/palettes";
import { startHost } from "../../src/host/server";
import { frecencyRank, parseDurationMs, substituteTemplate } from "../../src/shared/palettes";

const dirs: string[] = [];
function tempDir(prefix = "med-palettes-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("shared palette utilities", () => {
  test("parseDurationMs handles common units", () => {
    expect(parseDurationMs("500ms")).toBe(500);
    expect(parseDurationMs("30s")).toBe(30_000);
    expect(parseDurationMs("15m")).toBe(900_000);
    expect(parseDurationMs("6h")).toBe(21_600_000);
    expect(parseDurationMs("2d")).toBe(172_800_000);
    expect(parseDurationMs(0)).toBe(0);
    expect(parseDurationMs("invalid")).toBeNull();
  });

  test("substituteTemplate replaces placeholders and encodes values when requested", () => {
    expect(
      substituteTemplate(
        "/dashboards/work/health?var-env=${env}&var-service=${product}",
        { env: "prod", product: "checkout api" },
        true,
      ),
    ).toBe("/dashboards/work/health?var-env=prod&var-service=checkout%20api");
    expect(
      substituteTemplate("deploy status ${env} ${product}", { env: "prod", product: "checkout" }),
    ).toBe("deploy status prod checkout");
  });

  test("frecencyRank applies zoxide recency buckets", () => {
    const now = 1_700_000_000_000;
    const recent = frecencyRank({ score: 2, lastVisited: now - 10 * 60_000 }, now);
    const sameDay = frecencyRank({ score: 2, lastVisited: now - 5 * 3_600_000 }, now);
    const week = frecencyRank({ score: 2, lastVisited: now - 3 * 86_400_000 }, now);
    const old = frecencyRank({ score: 2, lastVisited: now - 20 * 86_400_000 }, now);
    expect(recent).toBe(8);
    expect(sameDay).toBe(4);
    expect(week).toBe(1);
    expect(old).toBe(0.5);
  });
});

describe("parsePalette and parseItemsText", () => {
  test("parses a complete multi-step palette YAML", () => {
    const yaml = `
title: Deployments
keyword: deploy
description: Check service deployments
steps:
  - name: env
    placeholder: Environment
    cache: 24h
    source:
      options:
        - value: prod
          label: Production
        - staging
  - name: product
    placeholder: Product
    cache: 6h
    dependsOn: [env]
    source:
      command: echo '[]'
      value: slug
      label: name
      subtitle: team
actions:
  - label: Open deployment status
    default: true
    openUrl: https://deploy.internal/\${env}/\${product}
  - label: Copy CLI
    copy: work-deploy status \${env} \${product}
`;
    const parsed = parsePalette(yaml, "fallback");
    expect(parsed.problems).toEqual([]);
    expect(parsed.spec?.title).toBe("Deployments");
    expect(parsed.spec?.keyword).toBe("deploy");
    expect(parsed.spec?.steps).toHaveLength(2);
    expect(parsed.spec?.steps[0]?.cacheMs).toBe(86_400_000);
    expect(parsed.spec?.steps[0]?.source.options).toEqual([
      { value: "prod", label: "Production", subtitle: undefined, keywords: undefined },
      { value: "staging", label: "staging" },
    ]);
    expect(parsed.spec?.steps[1]?.dependsOn).toEqual(["env"]);
    expect(parsed.spec?.actions[0]?.default).toBe(true);
  });

  test("parses JSON, JSONL, CSV, and line-delimited items", () => {
    expect(
      parseItemsText(
        JSON.stringify([
          { slug: "checkout-api", name: "Checkout API", team: "Payments" },
          { slug: "auth", name: "Auth Gateway", team: "Core" },
        ]),
        { value: "slug", label: "name", subtitle: "team" },
      ),
    ).toEqual([
      { value: "checkout-api", label: "Checkout API", subtitle: "Payments", keywords: undefined },
      { value: "auth", label: "Auth Gateway", subtitle: "Core", keywords: undefined },
    ]);

    expect(
      parseItemsText('{"id":"prod","name":"Production"}\n{"id":"stg","name":"Staging"}\n', {
        value: "id",
        label: "name",
      }),
    ).toEqual([
      { value: "prod", label: "Production", subtitle: undefined, keywords: undefined },
      { value: "stg", label: "Staging", subtitle: undefined, keywords: undefined },
    ]);

    expect(
      parseItemsText("slug,name,team\nbilling,Billing Worker,Finance\n", {
        value: "slug",
        label: "name",
        subtitle: "team",
      }),
    ).toEqual([
      { value: "billing", label: "Billing Worker", subtitle: "Finance", keywords: undefined },
    ]);

    expect(parseItemsText("prod\nstaging\ndev\n", {})).toEqual([
      { value: "prod", label: "prod" },
      { value: "staging", label: "staging" },
      { value: "dev", label: "dev" },
    ]);
  });
});

describe("createPalettes discovery, SWR cache, and frecency", () => {
  test("discovers palettes, caches command output on disk with SWR, and persists frecency", async () => {
    const root = tempDir();
    const palettesDir = join(root, "palettes");
    const stateDir = join(root, "state");
    const repoDir = join(root, "repo");
    const counterFile = join(root, "runs.txt");
    mkdirSync(palettesDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(repoDir, { recursive: true });

    // A short-TTL command that appends a line each time it executes and outputs the run count + env.
    const cmd = `node -e '
      const fs = require("fs");
      const n = (fs.existsSync(${JSON.stringify(counterFile)}) ? fs.readFileSync(${JSON.stringify(counterFile)}, "utf8").trim().split("\\n").filter(Boolean).length : 0) + 1;
      fs.appendFileSync(${JSON.stringify(counterFile)}, n + "\\n");
      const env = process.env.MED_PALETTE_ENV || "none";
      console.log(JSON.stringify([{ slug: "checkout", name: "Checkout " + env + " #" + n, team: "Payments" }]));
    '`;

    writeFileSync(
      join(palettesDir, "deployments.palette.yaml"),
      `
title: Deployments
keyword: deploy
steps:
  - name: env
    placeholder: Environment
    source:
      options:
        - value: prod
          label: Production
        - value: staging
          label: Staging
  - name: product
    placeholder: Product
    cache: 80ms
    dependsOn: [env]
    source:
      command: ${JSON.stringify(cmd)}
      value: slug
      label: name
      subtitle: team
actions:
  - label: Open status
    default: true
    openUrl: https://deploy.internal/\${env}/\${product}
`,
    );

    writeFileSync(
      join(repoDir, "services.palette.yaml"),
      `
title: Repo Services
steps:
  - name: svc
    placeholder: Service
    source:
      options: [api, web]
actions:
  - label: Copy
    copy: \${svc}
`,
    );

    let clock = 1_700_000_000_000;
    const palettes = createPalettes({
      folder: palettesDir,
      cacheDir: join(stateDir, "palette-cache"),
      frecencyFile: join(stateDir, "palette-frecency.json"),
      repositories: () => [{ name: "atlas", path: repoDir }],
      now: () => clock,
    });

    const listed = await palettes.list();
    expect(listed.palettes.map((p) => p.id)).toEqual(["personal/deployments", "atlas/services"]);

    // 1. Cold fetch executes command once.
    const cold = await palettes.items({
      paletteId: "personal/deployments",
      step: "product",
      values: { env: "prod" },
    });
    expect(cold.fromCache).toBe(false);
    expect(cold.stale).toBe(false);
    expect(cold.items[0]?.label).toBe("Checkout prod #1");

    // 2. Warm fetch returns disk/memory cache without re-running the command.
    clock += 20;
    const warm = await palettes.items({
      paletteId: "personal/deployments",
      step: "product",
      values: { env: "prod" },
    });
    expect(warm.fromCache).toBe(true);
    expect(warm.stale).toBe(false);
    expect(warm.items[0]?.label).toBe("Checkout prod #1");

    // 3. Different dependsOn value partitions the cache cleanly.
    const staging = await palettes.items({
      paletteId: "personal/deployments",
      step: "product",
      values: { env: "staging" },
    });
    expect(staging.fromCache).toBe(false);
    expect(staging.items[0]?.label).toBe("Checkout staging #2");

    // 4. Advance past TTL (80ms): returns stale cache immediately and refreshes in background.
    clock += 100;
    const stale = await palettes.items({
      paletteId: "personal/deployments",
      step: "product",
      values: { env: "prod" },
    });
    expect(stale.fromCache).toBe(true);
    expect(stale.stale).toBe(true);
    expect(stale.items[0]?.label).toBe("Checkout prod #1");

    // Wait briefly for the background refresh to settle, then read again (within fresh TTL).
    await new Promise((resolve) => setTimeout(resolve, 350));
    const refreshed = await palettes.items({
      paletteId: "personal/deployments",
      step: "product",
      values: { env: "prod" },
    });
    expect(refreshed.fromCache).toBe(true);
    expect(refreshed.stale).toBe(false);
    expect(refreshed.items[0]?.label).toBe("Checkout prod #3");

    // 5. Explicit force refresh bypasses cache.
    const forced = await palettes.items({
      paletteId: "personal/deployments",
      step: "product",
      values: { env: "prod" },
      refresh: true,
    });
    expect(forced.fromCache).toBe(false);
    expect(forced.items[0]?.label).toBe("Checkout prod #4");

    // 6. Zoxide frecency persists to disk across instances.
    await palettes.recordVisit(
      "personal/deployments",
      { env: "staging", product: "billing" },
      { env: "Staging", product: "Billing Worker" },
    );
    await palettes.recordVisit(
      "personal/deployments",
      { env: "prod", product: "checkout" },
      { env: "Production", product: "Checkout API" },
    );
    await palettes.recordVisit(
      "personal/deployments",
      { env: "prod", product: "checkout" },
      { env: "Production", product: "Checkout API" },
    );

    const restarted = createPalettes({
      folder: palettesDir,
      cacheDir: join(stateDir, "palette-cache"),
      frecencyFile: join(stateDir, "palette-frecency.json"),
      repositories: () => [],
    });
    const frecency = await restarted.listFrecency();
    expect(frecency[0]?.values).toEqual({ env: "prod", product: "checkout" });
    expect(frecency[0]?.score).toBe(2);
    expect(frecency[1]?.values).toEqual({ env: "staging", product: "billing" });
  });

  test("blocks shell commands and path escapes in untrusted repository palettes", async () => {
    const root = tempDir();
    const palettesDir = join(root, "palettes");
    const stateDir = join(root, "state");
    const repoDir = join(root, "untrusted-repo");
    const outsideFile = join(root, "secret.txt");
    mkdirSync(palettesDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(outsideFile, "top-secret\n");
    writeFileSync(join(repoDir, "services.txt"), "api\nworker\n");

    writeFileSync(
      join(repoDir, "evil.palette.yaml"),
      `
title: Untrusted Repo Palette
steps:
  - name: cmd
    placeholder: Command
    source:
      command: echo pwned
  - name: escape
    placeholder: Escape
    source:
      file: ../secret.txt
  - name: local
    placeholder: Local
    source:
      file: services.txt
actions:
  - label: Copy
    copy: \${local}
`,
    );

    const palettes = createPalettes({
      folder: palettesDir,
      cacheDir: join(stateDir, "palette-cache"),
      frecencyFile: join(stateDir, "palette-frecency.json"),
      repositories: () => [{ name: "untrusted", path: repoDir }],
    });

    await expect(
      palettes.items({ paletteId: "untrusted/evil", step: "cmd", values: {} }),
    ).rejects.toThrow(/personal palettes/i);
    await expect(
      palettes.items({ paletteId: "untrusted/evil", step: "escape", values: {} }),
    ).rejects.toThrow(/escapes/i);

    // Local file inside repo succeeds and re-reads edits (cacheMs === 0).
    const first = await palettes.items({ paletteId: "untrusted/evil", step: "local", values: {} });
    expect(first.items.map((item) => item.value)).toEqual(["api", "worker"]);
    writeFileSync(join(repoDir, "services.txt"), "api\nworker\nindexer\n");
    const second = await palettes.items({ paletteId: "untrusted/evil", step: "local", values: {} });
    expect(second.items.map((item) => item.value)).toEqual(["api", "worker", "indexer"]);
  });

  test("serializes concurrent recordVisit writes without losing updates", async () => {
    const root = tempDir();
    const palettes = createPalettes({
      folder: join(root, "palettes"),
      cacheDir: join(root, "cache"),
      frecencyFile: join(root, "frecency.json"),
      repositories: () => [],
    });

    await Promise.all([
      palettes.recordVisit("personal/deployments", { env: "prod" }, { env: "Production" }),
      palettes.recordVisit("personal/deployments", { env: "prod" }, { env: "Production" }),
      palettes.recordVisit("personal/deployments", { env: "staging" }, { env: "Staging" }),
      palettes.recordVisit("personal/deployments", { env: "prod" }, { env: "Production" }),
    ]);

    const entries = await palettes.listFrecency();
    const prod = entries.find((e) => e.values.env === "prod");
    const staging = entries.find((e) => e.values.env === "staging");
    expect(prod?.score).toBe(3);
    expect(staging?.score).toBe(1);
  });

  test("wires palette HTTP routes end-to-end on the Med host server", async () => {
    const root = tempDir();
    const repoDir = join(root, "repo");
    const stateDir = join(root, "state");
    const settingsPath = join(root, "settings.json");
    const palettesDir = join(root, "palettes");
    mkdirSync(repoDir, { recursive: true });
    mkdirSync(palettesDir, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoDir });
    writeFileSync(join(repoDir, "README.md"), "# demo\n");
    execFileSync("git", ["add", "."], { cwd: repoDir });
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "init"],
      { cwd: repoDir },
    );
    writeFileSync(
      join(palettesDir, "deploy.palette.yaml"),
      `
title: Deployments
keyword: deploy
steps:
  - name: env
    placeholder: Environment
    source:
      options:
        - value: prod
          label: Production
actions:
  - label: Copy
    copy: deploy \${env}
`,
    );

    const host = await startHost({
      repo: repoDir,
      port: 0,
      open: false,
      stateDir,
      settingsPath,
    });
    try {
      const baseUrl = `http://127.0.0.1:${host.port}`;
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${host.token}`,
      };
      const listRes = await fetch(`${baseUrl}/api/palettes`, { headers });
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as { palettes: { id: string; title: string }[] };
      expect(listBody.palettes.map((p) => p.id)).toContain("personal/deploy");

      const itemsRes = await fetch(`${baseUrl}/api/palettes/items`, {
        method: "POST",
        headers,
        body: JSON.stringify({ paletteId: "personal/deploy", step: "env", values: {} }),
      });
      expect(itemsRes.status).toBe(200);
      const itemsBody = (await itemsRes.json()) as { items: { value: string; label: string }[] };
      expect(itemsBody.items).toEqual([{ value: "prod", label: "Production" }]);

      const visitRes = await fetch(`${baseUrl}/api/palettes/visit`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          paletteId: "personal/deploy",
          values: { env: "prod" },
          labels: { env: "Production" },
        }),
      });
      expect(visitRes.status).toBe(200);

      const frecencyRes = await fetch(`${baseUrl}/api/palettes/frecency`, { headers });
      expect(frecencyRes.status).toBe(200);
      const frecencyBody = (await frecencyRes.json()) as {
        entries: { paletteId: string; score: number }[];
      };
      expect(frecencyBody.entries[0]).toMatchObject({ paletteId: "personal/deploy", score: 1 });
    } finally {
      await host.close();
    }
  });
});
