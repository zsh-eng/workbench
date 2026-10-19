import { env, SELF } from "cloudflare:test";

export interface TestUser {
  email: string;
  password: string;
  name: string;
  sessionCookie: string;
  userId: string;
}

/**
 * Creates a test user via Better Auth's sign-up API and returns
 * the user credentials along with the session cookie.
 */
export async function createTestUser(
  email: string,
  password: string,
  name: string,
): Promise<TestUser> {
  const signUpResponse = await SELF.fetch(
    "http://example.com/api/auth/sign-up/email",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        name,
      }),
    },
  );

  if (!signUpResponse.ok) {
    throw new Error(`Failed to create test user: ${signUpResponse.status}`);
  }

  // Extract the session cookie from the response
  const setCookie = signUpResponse.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("No session cookie returned from sign-up");
  }

  const sessionCookie = setCookie.split(";")[0]; // e.g., "better-auth.session_token=..."

  // Get the user ID
  const meResponse = await SELF.fetch("http://example.com/api/me", {
    headers: { Cookie: sessionCookie },
  });

  if (!meResponse.ok) {
    throw new Error(`Failed to get user ID: ${meResponse.status}`);
  }

  const meData = await meResponse.json();

  return {
    email,
    password,
    name,
    sessionCookie,
    userId: meData.user.id,
  };
}

/**
 * Uploads a test file to the R2 bucket.
 * Returns the R2 key where the file was stored.
 */
export async function uploadTestFile(
  r2Key: string,
  content: string | Uint8Array,
  contentType?: string,
): Promise<void> {
  const bucket = env.BOOK_STORAGE as R2Bucket;

  await bucket.put(r2Key, content, {
    httpMetadata: contentType ? { contentType } : undefined,
  });
}
