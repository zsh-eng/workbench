import {
  expect,
  type APIRequestContext,
  type BrowserContext,
} from "@playwright/test";
import { createHash } from "node:crypto";
import { xxh64 } from "../src/sync/xxh64";

export const API = `http://localhost:${process.env.E2E_API_PORT ?? "8792"}`;
const origin = { Origin: `http://localhost:${process.env.E2E_PORT ?? "5186"}` };

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

/**
 * Polls until a value matches. The app uploads a moment after each change
 * and a sheet settles within a second, so this asks every 100 ms instead of
 * backing off to a second as expect.poll does.
 */
export const eventually = <T>(read: () => Promise<T> | T, timeout = 15_000) =>
  expect.poll(read, { intervals: [100], timeout });

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
const swiftDate = (ms: number) => (ms - 978_307_200_000) / 1000;

type PulledRecord = {
  key: string;
  value: string;
  isDeleted: boolean;
  deviceId: string;
};

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
    /**
     * The latest record of each key. A pull pages up to the head it read
     * first, so a record that the app pushes meanwhile moves past that head
     * and arrives in the next pull; pull until the cursor stays.
     */
    async records() {
      const latest = new Map<string, PulledRecord>();
      for (let cursor = 0, pulls = 0; pulls < 20; pulls++) {
        const response = await request.get(
          `${API}/api/apps/${namespace}/sync/v3/pull?cursor=${cursor}&excludeOwnDevice=false&limit=500`,
          {
            headers: {
              ...origin,
              "X-Device-ID": "iphone",
              "X-Sync-Scope": await scope(),
            },
          },
        );
        expect(response.ok()).toBeTruthy();
        const page = (await response.json()) as {
          records: PulledRecord[];
          cursor: number;
        };
        for (const record of page.records) latest.set(record.key, record);
        if (page.cursor === cursor) break;
        cursor = page.cursor;
      }
      return latest;
    },
  };
}

/** An article as the phone stores it: three records keyed by the URL's SHA-256. */
export function article(
  url: string,
  options: {
    title: string;
    subtitle?: string;
    image?: string;
    tags?: string[];
    savedAt?: number;
    archived?: boolean;
  } & Record<string, unknown>,
) {
  const id = identity(url);
  const {
    title,
    subtitle = "",
    image,
    tags = [],
    savedAt = Date.now(),
    archived = false,
    ...library
  } = options;
  return {
    id,
    url,
    records: [
      {
        key: `article/${id}`,
        value: sorted({
          url,
          title,
          subtitle,
          ...(image ? { imageURL: image } : {}),
        }),
      },
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

/** Adds a text copy to the account, as Arctic for the web saves one. */
export async function addText(
  request: APIRequestContext,
  item: { id: string; url: string },
  html: string,
) {
  const bytes = new TextEncoder().encode(html);
  const file = xxh64(bytes);
  const scope = JSON.stringify(
    await (
      await request.get(`${API}/api/apps/arctic-content/sync/v3/state`)
    ).json(),
  );
  const upload = await request.put(
    `${API}/api/apps/arctic-content/files/${file}`,
    {
      headers: {
        ...origin,
        "X-Sync-Scope": scope,
        "Content-Type": "text/html; charset=utf-8",
      },
      data: Buffer.from(bytes),
    },
  );
  expect(upload.ok()).toBeTruthy();
  await phone(request, "arctic-content").push([
    {
      key: `content/${item.id}`,
      value: sorted({
        url: item.url,
        file,
        bytes: bytes.byteLength,
        words: html.split(/\s+/).length,
        format: "html",
        source: "file",
        savedAt: Date.now(),
      }),
    },
  ]);
}
