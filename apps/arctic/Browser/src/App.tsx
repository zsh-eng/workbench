import { Activity, useEffect, useState } from "react";
import {
  Navigate,
  Outlet,
  RouterProvider,
  ScrollRestoration,
  createBrowserRouter,
  useMatches,
} from "react-router-dom";
import {
  currentAccount,
  rememberedAccount,
  signInLocally,
  signInWithGoogle,
  type Account,
} from "./api";
import type { Folder } from "./articles";
import { Copies } from "./Copies";
import { Library } from "./Library";
import { Reader } from "./Reader";
import { SessionContext } from "./state";
import { Session } from "./sync/session";
import { Toaster } from "./ui";

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      // Root renders the library for these routes; see KeptLibrary.
      { index: true, element: null, handle: { folder: "saved" } },
      { path: "favourites", element: null, handle: { folder: "favourites" } },
      { path: "archive", element: null, handle: { folder: "archive" } },
      { path: "history", element: null, handle: { folder: "history" } },
      { path: "read/:id", element: <Reader /> },
      { path: "copies", element: <Copies /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

type Opened =
  | { account: null }
  | { account: Account; session: Session; offline: boolean };

/** Opens once per page load; a remembered account opens offline from this browser's copy. */
let opening: Promise<Opened> | undefined;
function open(): Promise<Opened> {
  opening ??= (async () => {
    let account: Account | null;
    let offline = false;
    try {
      account = await currentAccount();
    } catch {
      account = rememberedAccount();
      offline = true;
    }
    if (!account) return { account: null };
    return { account, session: await Session.open(account), offline };
  })();
  return opening;
}

export function App() {
  const [opened, setOpened] = useState<Opened | Error | undefined>();
  useEffect(() => {
    open().then(setOpened, (error: Error) => setOpened(error));
  }, []);
  if (opened === undefined)
    return <div className="quiet-page">Opening Arctic…</div>;
  if (opened instanceof Error)
    return (
      <div className="quiet-page">Arctic could not open: {opened.message}</div>
    );
  if (!opened.account) return <Welcome />;
  return (
    <SessionContext.Provider value={opened.session}>
      <RouterProvider router={router} />
    </SessionContext.Provider>
  );
}

function Root() {
  const handle = useMatches().at(-1)?.handle as { folder?: Folder } | undefined;
  return (
    <>
      <ScrollRestoration />
      <SyncTriggers />
      <KeptLibrary folder={handle?.folder} />
      <Outlet />
      <Toaster />
    </>
  );
}

/**
 * The library stays mounted, hidden, while an article or another page is
 * open, so Back shows it at once with its cards, search and scroll position.
 */
function KeptLibrary({ folder }: { folder?: Folder }) {
  const [last, setLast] = useState(folder);
  if (folder && folder !== last) setLast(folder);
  const shown = folder ?? last;
  if (!shown) return null;
  return (
    <Activity mode={folder ? "visible" : "hidden"}>
      <Library folder={shown} />
    </Activity>
  );
}

/** Sync on open, on return to the tab, when the network comes back, and every five minutes. */
function SyncTriggers() {
  useEffect(() => {
    let session: Session | undefined;
    void open().then((opened) => {
      if (!("session" in opened)) return;
      session = opened.session;
      void session.sync().catch(() => {});
    });
    const sync = () => {
      if (document.visibilityState === "visible")
        void session?.sync().catch(() => {});
    };
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("online", sync);
    const timer = setInterval(sync, 5 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("online", sync);
      clearInterval(timer);
    };
  }, []);
  return null;
}

function Welcome() {
  const [error, setError] = useState(
    new URLSearchParams(location.search).get("signin") === "failed"
      ? "Google sign-in did not finish. Try again."
      : "",
  );
  const [busy, setBusy] = useState(false);
  return (
    <main className="welcome">
      <div className="welcome-card">
        <img src="/icon-192.png" alt="" />
        <h1>Arctic</h1>
        <p>
          Your reading library, in the browser. Saved on your iPhone, ready
          here.
        </p>
        {error && <p className="notice">{error}</p>}
        <button
          type="button"
          className="button primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            signInWithGoogle().catch((reason: Error) => {
              setError(reason.message);
              setBusy(false);
            });
          }}
        >
          Continue with Google
        </button>
        <small>
          Use the Google account that you sync Arctic with on your iPhone.
        </small>
        {import.meta.env.DEV && (
          <form
            className="local-sign-in"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              signInLocally(
                String(form.get("email")),
                String(form.get("password")),
              ).then(
                () => location.reload(),
                (reason: Error) => setError(reason.message),
              );
            }}
          >
            <input
              name="email"
              type="email"
              placeholder="Local email"
              required
            />
            <input
              name="password"
              type="password"
              placeholder="Password"
              minLength={8}
              required
            />
            <button type="submit" className="button">
              Local account
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
