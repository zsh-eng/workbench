import {
  expect,
  type APIRequestContext,
  type BrowserContext,
} from "@playwright/test";
import { createHash } from "node:crypto";

export const API = "http://localhost:8792";
const origin = { Origin: "http://localhost:5186" };

/** A fresh local account; the browser context holds its session. */
export async function signUp(context: BrowserContext) {
  const response = await context.request.post(`${API}/api/auth/sign-up/email`, {
    data: {
      email: `arctic-${crypto.randomUUID()}@example.test`,
      password: crypto.randomUUID(),
      name: "Test reader",
    },
    headers: origin,
  });
  expect(response.ok()).toBeTruthy();
}

/** Swift JSONEncoder with .sortedKeys, as the phone writes records. */
export const sorted = (value: Record<string, unknown>) =>
  JSON.stringify(
    Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, value[key]]),
    ),
  );
export const identity = (url: string) =>
  createHash("sha256").update(url).digest("hex");
export const swiftDate = (ms: number) => (ms - 978_307_200_000) / 1000;

/** Acts as the phone: pushes and pulls records through the shared API. */
export function phone(request: APIRequestContext, namespace = "arctic") {
  let wallTimeMs = Date.now();
  const scope = async () =>
    JSON.stringify(
      await (
        await request.get(`${API}/api/apps/${namespace}/sync/v3/state`)
      ).json(),
    );
  return {
    async push(records: { key: string; value: string; isDeleted?: boolean }[]) {
      wallTimeMs = Math.max(wallTimeMs + 1, Date.now());
      const response = await request.post(
        `${API}/api/apps/${namespace}/sync/v3/push`,
        {
          headers: {
            ...origin,
            "X-Device-ID": "iphone",
            "X-Sync-Scope": await scope(),
          },
          data: {
            changes: records.map((record) => ({
              key: record.key,
              value: record.value,
              isDeleted: record.isDeleted ?? false,
              schemaVersion: 1,
              hlc: { wallTimeMs, counter: 0 },
            })),
          },
        },
      );
      expect(response.ok()).toBeTruthy();
    },
    async records() {
      const response = await request.get(
        `${API}/api/apps/${namespace}/sync/v3/pull?cursor=0&excludeOwnDevice=false&limit=500`,
        {
          headers: {
            ...origin,
            "X-Device-ID": "iphone",
            "X-Sync-Scope": await scope(),
          },
        },
      );
      expect(response.ok()).toBeTruthy();
      const { records } = (await response.json()) as {
        records: {
          key: string;
          value: string;
          isDeleted: boolean;
          deviceId: string;
        }[];
      };
      return new Map(records.map((record) => [record.key, record]));
    },
  };
}

/** An article as the phone stores it: three records keyed by the URL's SHA-256. */
export function article(
  url: string,
  options: {
    title: string;
    subtitle?: string;
    tags?: string[];
    savedAt?: number;
    archived?: boolean;
  } & Record<string, unknown>,
) {
  const id = identity(url);
  const {
    title,
    subtitle = "",
    tags = [],
    savedAt = Date.now(),
    archived = false,
    ...library
  } = options;
  return {
    id,
    url,
    records: [
      { key: `article/${id}`, value: sorted({ url, title, subtitle }) },
      {
        key: `library/${id}`,
        value: sorted({
          url,
          saved: true,
          archived,
          read: false,
          savedAt: swiftDate(savedAt),
          ...library,
        }),
      },
      {
        key: `tags/${id}`,
        value: sorted({
          url,
          names: tags,
          manual: tags,
          automatic: [],
          rejected: [],
          generation: "0F8B2E0C-6E44-4A55-9B3C-0D6D5C6B7A10",
        }),
      },
    ],
  };
}

export const paragraphs = (count: number) =>
  Array.from(
    { length: count },
    (_, index) =>
      `<p>Paragraph ${index + 1}. Sea ice forms, drifts and thins with the seasons, and the people who read it keep careful notes about where it goes.</p>`,
  ).join("");
