import { deckRecord, streamResponse } from "./sync-fixtures";
import { beforeEach, afterEach, expect, test, spyOn } from "bun:test";
import { act } from "react";
import { MemoryRouter } from "react-router";
import { render, click, input } from "./dom";
import { LoginForm } from "@/components/form/login-form";
import { RegisterForm } from "@/components/form/register-form";
import VerifyOtpForm from "@/components/form/verify-otp-form";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { useTheme } from "@/components/theme/theme-context";
import { useSessionExpired } from "@/components/hooks/session-expired";
import { login, register, verifyOtp, registerClient } from "@/lib/auth";
import {
  getClientId,
  getSessionExpiry,
  setClientId,
  setSessionExpiry,
} from "@/lib/sync/meta";
import SyncEngine from "@/lib/sync/engine";
import { db, rawDb, stateStore } from "@/lib/db/persistence";
import MemoryDB from "@/lib/db/memory";
import LoginSuccessRoute from "@/routes/LoginSuccessRoute";

const originalFetch = globalThis.fetch;
const originalMatchMedia = window.matchMedia;
const originalOnline = Object.getOwnPropertyDescriptor(navigator, "onLine");
const views: Awaited<ReturnType<typeof render>>[] = [];
async function mount(node: Parameters<typeof render>[0]) {
  const view = await render(node);
  views.push(view);
  return view;
}
async function settle(ms = 20) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
// Other test files can leave writes in the shared fake IndexedDB connection.
beforeEach(async () => {
  await Promise.all([
    rawDb.metadataKv.clear(),
    rawDb.operations.clear(),
    rawDb._sync_outbox.clear(),
    rawDb.reviewLogOperations.clear(),
  ]);
});
afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
  globalThis.fetch = originalFetch;
  window.matchMedia = originalMatchMedia;
  if (originalOnline)
    Object.defineProperty(navigator, "onLine", originalOnline);
  else Reflect.deleteProperty(navigator, "onLine");
  for (const deck of MemoryDB.getDecks())
    MemoryDB.putDeck({ ...deck, deleted: true });
  MemoryDB.notify();
  localStorage.removeItem("account-test-theme");
  document.documentElement.classList.remove("dark", "light");
  await Promise.all([
    rawDb.metadataKv.clear(),
    rawDb.operations.clear(),
    rawDb._sync_outbox.clear(),
    rawDb.reviewLogOperations.clear(),
  ]);
});

test("the first pull returns the active promise and resolves only after local application", async () => {
  await setClientId("pull-client");
  const response = deferred<Response>();
  globalThis.fetch = (async (url) =>
    String(url).endsWith("/me")
      ? Response.json({ userId: "test-user" })
      : response.promise) as typeof fetch;
  const first = SyncEngine.syncFromServer();
  expect(first).toBeInstanceOf(Promise);
  expect(SyncEngine.syncFromServer()).toBe(first);
  let finished = false;
  void first.then(() => {
    finished = true;
  });
  await settle();
  expect(finished).toBe(false);
  response.resolve(
    streamResponse({
      records: [deckRecord("pulled-deck", "Pulled", 7)],
      cursor: 7,
      head: 7,
      hasMore: false,
    }),
  );
  await first;
  expect(MemoryDB.getDeckById("pulled-deck")?.name).toBe("Pulled");
  expect(stateStore.read()?.pullCursor).toBe(7);
  expect(await db.operations.count()).toBe(1);
});

test("client registration waits for the local client ID write", async () => {
  globalThis.fetch = (async () =>
    Response.json({ clientId: "registered-client" })) as typeof fetch;
  const gate = deferred<void>();
  const put = db.metadataKv.put.bind(db.metadataKv);
  const spy = spyOn(db.metadataKv, "put").mockImplementation(
    (...args) =>
      gate.promise.then(() => put(...args)) as ReturnType<typeof put>,
  );
  try {
    let finished = false;
    const registering = registerClient().then(() => {
      finished = true;
    });
    await settle();
    expect(finished).toBe(false);
    gate.resolve();
    await registering;
    expect(await getClientId()).toBe(stateStore.read()?.deviceId);
  } finally {
    spy.mockRestore();
  }
});

test("successful code verification renews session expiry but rejected verification does not", async () => {
  await setSessionExpiry(new Date(1));
  globalThis.fetch = (async () =>
    Response.json({ success: true })) as typeof fetch;
  expect((await verifyOtp("person@example.com", "ABCD1234")).success).toBe(
    true,
  );
  const renewed = (await getSessionExpiry())!.getTime();
  expect(renewed).toBeGreaterThan(Date.now() + 6 * 86400000);
  globalThis.fetch = (async () =>
    Response.json(
      { message: "Incorrect code" },
      { status: 400 },
    )) as typeof fetch;
  expect((await verifyOtp("person@example.com", "BADCODE1")).success).toBe(
    false,
  );
  expect((await getSessionExpiry())!.getTime()).toBe(renewed);
});

for (const mode of ["login", "register"] as const) {
  test(`${mode} keeps fields and restores submission after a transport exception`, async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new TypeError("Network failed");
    }) as typeof fetch;
    const onSubmit = async (values: { email: string; password: string }) => {
      await (mode === "login" ? login : register)(
        values.email,
        values.password,
      );
    };
    const view = await mount(
      mode === "login" ? (
        <LoginForm onSubmit={onSubmit} />
      ) : (
        <RegisterForm onSubmit={onSubmit} />
      ),
    );
    const fields = [...view.container.querySelectorAll("input")];
    await input(fields[0], "person@example.com");
    for (const field of fields.slice(1)) await input(field, "test-password");
    await act(async () => {
      view.container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(
      view.container.querySelector('[role="alert"]')?.textContent,
    ).toContain("try again");
    expect(fields.map((field) => field.value)).toEqual(
      mode === "login"
        ? ["person@example.com", "test-password"]
        : ["person@example.com", "test-password", "test-password"],
    );
    expect(view.container.querySelector("button")!.disabled).toBe(false);
    await click(view.container.querySelector("button")!);
    expect(calls).toBe(2);
  });
}

test("OTP submits once while pending, keeps a failed code, and permits an explicit retry", async () => {
  const request = deferred<void>();
  let calls = 0;
  const onSubmit = async () => {
    calls++;
    await request.promise;
  };
  const view = await mount(<VerifyOtpForm onSubmit={onSubmit} />);
  const field = view.container.querySelector("input")!;
  await input(field, "abcd1234");
  expect(calls).toBe(1);
  expect(field.disabled).toBe(true);
  await act(async () => {
    view.container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await view.rerender(
    <VerifyOtpForm
      onSubmit={async () => {
        calls++;
        throw new Error("Still offline");
      }}
    />,
  );
  expect(calls).toBe(1);
  await act(async () => {
    request.reject(new TypeError("Network failed"));
  });
  await settle();
  expect(calls).toBe(1);
  expect(field.value).toBe("ABCD1234");
  expect(field.disabled).toBe(false);
  expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(
    "try again",
  );
  await click(view.container.querySelector("button")!);
  expect(calls).toBe(2);
  await settle();
  expect(calls).toBe(2);
});

test("System theme follows appearance changes and removes its listener for a fixed theme", async () => {
  const media = new window.EventTarget() as MediaQueryList;
  Object.defineProperty(media, "matches", { value: false, configurable: true });
  window.matchMedia = () => media;
  function ThemeChoice() {
    const { setTheme } = useTheme();
    return <button onClick={() => setTheme("light")}>Light</button>;
  }
  const view = await mount(
    <ThemeProvider storageKey="account-test-theme">
      <ThemeChoice />
    </ThemeProvider>,
  );
  expect(document.documentElement.classList.contains("light")).toBe(true);
  Object.defineProperty(media, "matches", { value: true, configurable: true });
  await act(async () => {
    media.dispatchEvent(new Event("change"));
  });
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  await click(view.container.querySelector("button")!);
  await act(async () => {
    media.dispatchEvent(new Event("change"));
  });
  expect(document.documentElement.classList.contains("light")).toBe(true);
});

test("the session-expired warning updates at the expiry boundary", async () => {
  await setSessionExpiry(new Date(Date.now() + 100));
  function Status() {
    return <span>{useSessionExpired() ? "expired" : "active"}</span>;
  }
  const view = await mount(<Status />);
  await settle();
  expect(view.container.textContent).toBe("active");
  await settle(140);
  expect(view.container.textContent).toBe("expired");
});

test("callback sync is a named native button and the button itself starts sync", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/me"))
      return Response.json({ userId: "test-user" });
    return streamResponse({
      records: [],
      cursor: stateStore.read()?.pullCursor ?? 0,
      head: stateStore.read()?.pullCursor ?? 0,
      hasMore: false,
    });
  }) as typeof fetch;
  const view = await mount(
    <MemoryRouter initialEntries={["/login-success?clientId=callback-client"]}>
      <LoginSuccessRoute />
    </MemoryRouter>,
  );
  const button = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Sync account data"]',
  );
  expect(button).not.toBeNull();
  await click(button!);
  await settle();
  expect(await getClientId()).toBe(stateStore.read()?.deviceId);
  expect(calls.some((url) => url.includes("/sync/v2/pull-stream?"))).toBe(true);
  await settle(1050);
});

test("offline account triggers are disabled native buttons", async () => {
  globalThis.fetch = (async () =>
    Response.json({ success: true })) as typeof fetch;
  Object.defineProperty(navigator, "onLine", {
    value: false,
    configurable: true,
  });
  const { LoginButton } = await import("@/components/profile/login-button");
  const { LogoutButton } = await import("@/components/profile/logout-button");
  const view = await mount(
    <>
      <LoginButton />
      <LogoutButton />
    </>,
  );
  await settle();
  const buttons = [...view.container.querySelectorAll("button")];
  expect(buttons).toHaveLength(2);
  for (const button of buttons) {
    expect(button.disabled).toBe(true);
    await click(button);
  }
  expect(
    document.querySelector('[role="dialog"], [role="alertdialog"]'),
  ).toBeNull();
  Object.defineProperty(navigator, "onLine", {
    value: true,
    configurable: true,
  });
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
  expect(buttons.every((button) => !button.disabled)).toBe(true);
});

test("privacy cleanup rejects failed logout, retries local failure offline, and blocks late sync writes", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "--preload",
      "./tests/setup.ts",
      "./tests/fixtures/account-privacy-check.tsx",
    ],
    { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
  );
  const timeout = setTimeout(() => child.kill(), 2500);
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  clearTimeout(timeout);
  expect({ status, stderr: status === 0 ? "" : stderr }).toEqual({
    status: 0,
    stderr: "",
  });
  expect(stdout).toContain("Privacy checks passed");
});

test("privacy wipe waits for an already-started local sync write before deleting the database", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "--preload",
      "./tests/setup.ts",
      "./tests/fixtures/sync-wipe-write-check.ts",
    ],
    { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
  );
  const timeout = setTimeout(() => child.kill(), 2500);
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  clearTimeout(timeout);
  expect({ status, stderr: status === 0 ? "" : stderr }).toEqual({
    status: 0,
    stderr: "",
  });
  expect(stdout).toContain("In-flight write checks passed");
});
