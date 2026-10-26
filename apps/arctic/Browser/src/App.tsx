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
import { HighlightsPage } from "./HighlightsPage";
import { ReadingPage } from "./ReadingPage";
import { SettingsPage } from "./SettingsPage";
import { SessionContext, articles } from "./state";
import { downloadNew } from "./offline";
import { articleText, decodedImage, prefetch } from "./text";
import { Session } from "./sync/session";
import { preloadSheet } from "./surface";
import { Toaster } from "./ui";

type Opened = { account: null } | { account: Account; session: Session };

/**
 * Opens once per page load. A remembered account opens this browser's copy at
 * once, as Reader opens its library, and starts sync; the account check
 * follows (see App).
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
    downloadAfterSync(session);
    session.controller.start();
    return { account, session };
  })();
  return opening;
}

/**
 * The session's controller syncs on open, on reconnect, on return to the tab
 * and every five minutes. New text downloads after each sync when Offline is
 * on (see offline.ts). After the first sync of a visit, copies that no record
 * names any more leave this browser.
 */
function downloadAfterSync(session: Session) {
  const { controller } = session;
  let last = controller.getSnapshot().lastSyncedAt;
  let pruned = false;
  controller.subscribe(() => {
    const { lastSyncedAt } = controller.getSnapshot();
    if (lastSyncedAt === last) return;
    last = lastSyncedAt;
    void downloadNew(session, articles(session));
    if (pruned) return;
    pruned = true;
    void session.pruneFiles().catch(() => {});
  });
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
      { path: "reading", element: <ReadingPage /> },
      { path: "highlights", element: <HighlightsPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

/**
 * Opening an article waits up to 100 ms for its text and cover, so they
 * arrive with the page and the page change animates the final layout. Cards
 * prefetch both (see prefetch), so the wait is usually none; a text from the
 * network follows the page.
 */
async function readFirst({ params }: LoaderFunctionArgs) {
  performance.mark("arctic:load");
  const opened = await open().catch(() => null);
  if (!opened?.account) return null;
  const article = articles(opened.session).find(
    (item) => item.id === params.id,
  );
  if (!article) return null;
  prefetch(opened.session, article);
  await Promise.race([
    Promise.all([
      articleText(opened.session, article),
      decodedImage(article.image),
    ]),
    new Promise((resolve) => setTimeout(resolve, 100)),
  ]);
  performance.mark("arctic:loaded");
  return null;
}

export function App() {
  const [opened, setOpened] = useState<Opened | Error | undefined>();
  useEffect(() => {
    open().then(setOpened, (error: Error) => setOpened(error));
  }, []);
  // The server confirms the remembered account in the background. An ended
  // session keeps the library open and asks to sign in again; another
  // account reloads. No answer (offline, unreachable) changes nothing.
  const session =
    opened && !(opened instanceof Error) && opened.account
      ? opened.session
      : undefined;
  useEffect(() => {
    if (!session) return;
    currentAccount().then(
      (account) => {
        if (!account) session.controller.confirmSignedOut();
        else if (account.userId !== session.account.userId) location.reload();
        else session.controller.confirmSignedIn(account);
      },
      () => {},
    );
  }, [session]);
  // Opening reads IndexedDB only; a blank frame is shorter than a message.
  if (opened === undefined) return null;
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
  // Every page can open a sheet, an article opened from a link as well.
  useEffect(preloadSheet, []);
  return (
    <>
      <ScrollRestoration />
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
