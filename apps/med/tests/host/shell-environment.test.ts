import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { agentEnvironment } from "../../src/host/owned-sessions";
import {
  loadShellEnvironment,
  readShellEnvironment,
  wantsShellEnvironment,
} from "../../src/host/shell-environment";

// A login shell stand-in: its profile prints text and exports a token, as a
// ~/.zshrc that reads a token from the keychain does, then runs the command.
let directory = "";
const saved = {
  SHELL: process.env.SHELL,
  MED_SHELL_ENVIRONMENT: process.env.MED_SHELL_ENVIRONMENT,
};
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "med-shell-env-"));
});
afterEach(async () => {
  for (const [name, value] of Object.entries(saved))
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  await loadShellEnvironment();
  await rm(directory, { recursive: true, force: true });
});
const shell = async (profile: string) => {
  const path = join(directory, "shell");
  await writeFile(path, `#!/bin/sh\n${profile}\nexec /bin/sh -c "$4"\n`);
  await chmod(path, 0o755);
  return path;
};

test("the login service gives agents the variables that the user's shell profile exports", async () => {
  process.env.SHELL = await shell(
    'echo "Welcome back"\nexport ANTHROPIC_API_KEY="from-profile"\nexport MULTI="a=b\nc"',
  );
  process.env.MED_SHELL_ENVIRONMENT = "1";
  await loadShellEnvironment();
  const env = agentEnvironment({ MED_THREAD: "t1" });
  expect(env.ANTHROPIC_API_KEY).toBe("from-profile");
  expect(env.MULTI).toBe("a=b\nc");
  expect(env.MED_THREAD).toBe("t1");
  // The shell's own variables do not leak.
  expect(env.MED_RESOLVING_ENVIRONMENT).toBeUndefined();
  expect(env.SHLVL).toBe(process.env.SHLVL);

  // A host started from a terminal reads nothing: it has the environment.
  process.env.MED_SHELL_ENVIRONMENT = "0";
  await loadShellEnvironment();
  expect(agentEnvironment().ANTHROPIC_API_KEY).toBe(process.env.ANTHROPIC_API_KEY);
});

test("a shell that hangs or prints no environment leaves Med's own environment", async () => {
  await expect(readShellEnvironment(await shell("sleep 30"), 300)).rejects.toThrow("in time");
  await expect(readShellEnvironment(await shell("exit 1"))).rejects.toThrow("no environment");
});

test("only Med's own LaunchAgent reads the shell environment by default", () => {
  expect(wantsShellEnvironment({ XPC_SERVICE_NAME: "local.med.0123456789ab" }, "darwin")).toBe(
    true,
  );
  expect(wantsShellEnvironment({ XPC_SERVICE_NAME: "0" }, "darwin")).toBe(false);
  expect(wantsShellEnvironment({}, "darwin")).toBe(false);
  expect(wantsShellEnvironment({ XPC_SERVICE_NAME: "local.med.0123456789ab" }, "linux")).toBe(
    false,
  );
});
