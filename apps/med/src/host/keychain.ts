import { execFile } from "node:child_process";
import { keychainCommand } from "../shared/charts";
import { HostError } from "./runtime/errors";

// A secret in the macOS Keychain, such as a Grafana token: Med reads it when
// it needs it and keeps no copy in its files. The item is a generic password
// found by its service name, as `security add-generic-password -s <item>`
// makes one. An item made that way already lets `security` read it; another
// asks the reader once, in a macOS prompt.

/** A Keychain item's name: words, dots, dashes, and spaces, as a service name. */
export function keychainItem(text: string): string | null {
  const item = text.trim();
  const control = [...item].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
  return item && item.length <= 255 && !control ? item : null;
}

/** Reads the password of the Keychain item named `item`. */
export function readKeychain(item: string): Promise<string> {
  if (process.platform !== "darwin")
    return Promise.reject(
      new HostError("grafana-keychain", "A Keychain item works on macOS only.", 400),
    );
  return new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/security",
      ["find-generic-password", "-s", item, "-w"],
      // Long enough to answer macOS's prompt, for an item that asks.
      { timeout: 60_000, maxBuffer: 64 * 1024 },
      (error, stdout, stderr) => {
        const secret = stdout.replace(/\n$/, "");
        if (!error && secret) return resolve(secret);
        const code = (error as { code?: unknown } | null)?.code;
        if (code === 44)
          return reject(
            new HostError(
              "grafana-keychain",
              `Your Keychain has no item named ${item}. Add it in Terminal with: ${keychainCommand(item)}`,
              404,
            ),
          );
        const why = (error as { killed?: boolean } | null)?.killed
          ? "macOS's prompt had no answer within a minute"
          : stderr.replace(/^security:\s*/, "").trim() || "it holds no password";
        reject(
          new HostError(
            "grafana-keychain",
            `Med could not read ${item} from your Keychain: ${why}.`,
          ),
        );
      },
    );
  });
}
