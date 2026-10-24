/** The shared Workbench API. Local development uses `bun run dev:shared` on 8792. */
const configured = import.meta.env.VITE_SHARED_API_URL as string | undefined;
export const API_ORIGIN = new URL(
  configured ||
    (import.meta.env.PROD ? "https://api.zsheng.app" : "http://localhost:8792"),
).origin;

export type Account = {
  userId: string;
  email: string;
  name: string;
  image?: string;
};

const ACCOUNT_KEY = "arctic:account";

/** The last account lets the library open offline, from this browser's copy. */
export function rememberedAccount(): Account | null {
  try {
    const value = JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? "null");
    return value && typeof value.userId === "string" ? value : null;
  } catch {
    return null;
  }
}

/**
 * The signed-in account, or null when the server answers that there is none.
 * Rejects when no answer arrives. An ended session keeps the remembered
 * account, so this browser's copy still opens; signing out forgets it.
 */
export async function currentAccount(): Promise<Account | null> {
  const response = await fetch(`${API_ORIGIN}/api/me`, {
    credentials: "include",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401) return null;
  if (!response.ok)
    throw new Error(`The account check failed (${response.status}).`);
  const { user } = (await response.json()) as {
    user: { id: string; email: string; name: string; image?: string | null };
  };
  const account: Account = {
    userId: user.id,
    email: user.email,
    name: user.name,
    ...(user.image ? { image: user.image } : {}),
  };
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  return account;
}

async function auth(path: string, body: object) {
  const response = await fetch(`${API_ORIGIN}/api/auth/${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.message || `Sign-in failed (${response.status}).`);
  return data;
}

export async function signInWithGoogle() {
  const home = `${location.origin}/`;
  const { url } = await auth("sign-in/social", {
    provider: "google",
    callbackURL: home,
    errorCallbackURL: `${home}?signin=failed`,
  });
  if (typeof url !== "string")
    throw new Error("Google sign-in is not available.");
  location.assign(url);
}

/** Local development only: the local API accepts email accounts and creates them. */
export async function signInLocally(email: string, password: string) {
  try {
    await auth("sign-in/email", { email, password });
  } catch {
    await auth("sign-up/email", { email, password, name: email.split("@")[0] });
  }
}

export async function signOut() {
  await auth("sign-out", {});
  localStorage.removeItem(ACCOUNT_KEY);
}
