import { Activity, useEffect, useState } from "react";
import {
  Navigate,
  Outlet,
  RouterProvider,
  ScrollRestoration,
  createBrowserRouter,
  useMatches,
  type LoaderFunctionArgs,
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
import { SettingsPage } from "./SettingsPage";
import { SessionContext, articles } from "./state";
import { downloadNew } from "./offline";
import { articleText } from "./text";
import { Session } from "./sync/session";
import { Toaster } from "./ui";

type Opened =
  | { account: null; expired?: boolean }
  | { account: Account; session: Session };

/**
 * Opens once per page load. A remembered account opens this browser's copy at
 * once, as Reader opens its library; the account check follows (see App).
 */
let opening: Promise<Opened> | undefined;
function open(): Promise<Opened> {
  opening ??= (async () => {
    const account =
      rememberedAccount() ?? (await currentAccount().catch(() => null));
    if (!account) return { account: null };
    const session = await Session.open(account);
    performance.mark("arctic:open", {
      detail: { records: session.arctic.size + session.copies.size },
    });
    return { account, session };
  })();
  return opening;
}
// IndexedDB opens while React prepares its first render.
void open().catch(() => {});

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      // Root renders the library for these routes; see KeptLibrary.
      { index: true, element: null, handle: { folder: "saved" } },
      { path: "favourites", element: null, handle: { folder: "favourites" } },
      { path: "archive", element: null, handle: { folder: "archive" } },
      { path: "history", element: null, handle: { folder: "history" } },
      {
        path: "read/:id",
        element: <Reader />,
        loader: readFirst,
        hydrateFallbackElement: null,
      },
      { path: "copies", element: <Copies /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

/**
 * Opening an article waits up to 100 ms for its text, so the text arrives
 * with the page and the page change animates the final layout. A text from
 * IndexedDB takes a few milliseconds; one from the network follows the page.
 */
async function readFirst({ params }: LoaderFunctionArgs) {
  const opened = await open().catch(() => null);
  if (!opened?.account) return null;
  const article = articles(opened.session).find(
    (item) => item.id === params.id,
  );
  if (article?.copy)
    await Promise.race([
      articleText(opened.session, article),
      new Promise((resolve) => setTimeout(resolve, 100)),
    ]);
  return null;
}

export function App() {
  const [opened, setOpened] = useState<Opened | Error | undefined>();
  useEffect(() => {
    open().then(setOpened, (error: Error) => setOpened(error));
  }, []);
  // The server confirms the remembered account in the background. A signed-out
  // browser keeps its copy for the next sign-in; another account reloads.
  const userId =
    opened && !(opened instanceof Error) ? opened.account?.userId : undefined;
  useEffect(() => {
    if (!userId) return;
    currentAccount().then(
      (account) => {
        if (!account) setOpened({ account: null, expired: true });
        else if (account.userId !== userId) location.reload();
      },
      () => {
        /* Offline: the sync status says so. */
      },
    );
  }, [userId]);
  // Opening reads IndexedDB only; a blank frame is shorter than a message.
  if (opened === undefined) return null;
  if (opened instanceof Error)
    return (
      <div className="quiet-page">Arctic could not open: {opened.message}</div>
    );
  if (!opened.account) return <Welcome expired={opened.expired} />;
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

/**
 * Sync on open, on return to the tab, when the network comes back, and every
 * five minutes. New text downloads after a sync when Offline is on.
 */
function SyncTriggers() {
  useEffect(() => {
    let session: Session | undefined;
    const run = (current: Session) =>
      current.sync().then(
        () => downloadNew(current, articles(current)),
        () => {},
      );
    void open().then((opened) => {
      if (!("session" in opened)) return;
      session = opened.session;
      void run(session);
    });
    const sync = () => {
      if (session && document.visibilityState === "visible") void run(session);
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

function Welcome({ expired }: { expired?: boolean }) {
  const [error, setError] = useState(
    new URLSearchParams(location.search).get("signin") === "failed"
      ? "Google sign-in did not finish. Try again."
      : expired
        ? "You were signed out. Sign in again to sync."
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
