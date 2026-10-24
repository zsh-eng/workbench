import SyncEngine, { spacedSync } from "@/lib/sync/engine";
import { ensureSyncState, persistenceReady } from "@/lib/db/persistence";
import { setClientId } from "@/lib/sync/meta";
import { AUTH_API_BASE } from "../api";
async function request(path: string, body: unknown) {
  const response = await fetch(`${AUTH_API_BASE}/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}
export async function login(email: string, password: string) {
  const { response, data } = await request("sign-in/email", {
    email,
    password,
  });
  if (!response.ok)
    return {
      success: false as const,
      message: data.message ?? "Invalid email or password",
      isTempUser: data.code === "EMAIL_NOT_VERIFIED",
    };
  return { success: true as const };
}
export async function register(email: string, password: string) {
  const { response, data } = await request("sign-up/email", {
    email,
    password,
    name: email.split("@")[0],
  });
  const signedIn = response.ok && typeof data.token === "string";
  return {
    success: response.ok,
    signedIn,
    message: response.ok ? undefined : (data.message ?? "Registration failed"),
  };
}
export async function verifyOtp(email: string, pin: string) {
  const { response, data } = await request("email-otp/verify-email", {
    email,
    otp: pin,
  });
  if (!response.ok)
    return {
      success: false,
      message: data.message ?? "Incorrect or expired code",
    };
  return { success: true };
}
export async function registerClient() {
  await persistenceReady;
  await setClientId(ensureSyncState().deviceId);
  return { success: true, message: undefined };
}
export async function registerAndSync() {
  await registerClient();
  await SyncEngine.syncFromServer();
}
export async function logout() {
  const { response, data } = await request("sign-out", {});
  return {
    success: response.ok,
    message: response.ok ? undefined : (data.message ?? "Failed to sign out"),
  };
}
export async function signInWithGoogle() {
  const { response, data } = await request("sign-in/social", {
    provider: "google",
    callbackURL: new URL("/login-success", location.origin).href,
  });
  if (!response.ok || typeof data.url !== "string")
    throw new Error(data.message ?? "Google sign-in failed");
  // Back from the redirect, an ended session reads as unknown, not expired,
  // until the first sync's account check answers.
  spacedSync.beginSignIn();
  location.assign(data.url);
}
