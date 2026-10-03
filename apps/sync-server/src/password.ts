import { hashPassword, verifyPassword } from "better-auth/crypto";
export const LEGACY_PASSWORD_PREFIX = "legacy-pbkdf2:";
export { hashPassword };
export async function verifyStoredPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}) {
  if (!hash.startsWith(LEGACY_PASSWORD_PREFIX))
    return verifyPassword({ hash, password });
  try {
    const bytes = Uint8Array.from(
      atob(hash.slice(LEGACY_PASSWORD_PREFIX.length)),
      (c) => c.charCodeAt(0),
    );
    if (bytes.length !== 48) return false;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const result = new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          salt: bytes.slice(0, 16),
          iterations: 100000,
          hash: "SHA-256",
        },
        key,
        256,
      ),
    );
    let diff = 0;
    for (let i = 0; i < 32; i++) diff |= result[i] ^ bytes[i + 16];
    return diff === 0;
  } catch {
    return false;
  }
}
