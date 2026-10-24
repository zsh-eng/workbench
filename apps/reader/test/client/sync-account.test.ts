import { observeAuthSession, useAuth } from "@/hooks/use-auth";
import { authClient } from "@/lib/auth-client";
import { syncService } from "@/lib/sync-service";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// Better Auth keeps the fetch it finds when its client is created.
const server = vi.hoisted(() => {
  const state = {
    requests: 0,
    answer: (): Promise<Response> =>
      Promise.reject(new TypeError("Failed to fetch")),
  };
  globalThis.fetch = (() => {
    state.requests++;
    return state.answer();
  }) as typeof fetch;
  return state;
});

afterEach(() => {
  cleanup();
  syncService.controller.signOut();
  vi.restoreAllMocks();
});

it("keeps a remembered account through a failed session check; only the server's answer ends it", async () => {
  syncService.controller.confirmSignedIn(
    { userId: "reader-1", name: "Ada Reader", email: "ada@example.test" },
    "session-1",
  );
  const stop = observeAuthSession();
  try {
    const { result } = renderHook(useAuth);
    const session = authClient.$store.atoms.session;
    await waitFor(() => expect(server.requests).toBeGreaterThan(0));
    await waitFor(() => expect(session.get().isPending).toBe(false));
    // Offline, or a server that does not answer, is not a sign-out.
    expect(result.current).toMatchObject({
      status: "signed-in",
      isAuthenticated: true,
      user: { id: "reader-1", name: "Ada Reader" },
    });

    server.answer = () => Promise.resolve(Response.json(null));
    await act(() => session.get().refetch());
    expect(result.current).toMatchObject({
      status: "expired",
      isAuthenticated: false,
      user: { id: "reader-1", name: "Ada Reader" },
    });
  } finally {
    stop();
  }
});
