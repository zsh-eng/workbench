import { rm } from "node:fs/promises";
import { join } from "node:path";
import { listHolders, stopHolder } from "../../src/host/held-agent";

/** Removes a test's folder. Agents outlive their host (holder.ts), so the
 * agents that the test's hosts started in `<folder>/state` stop first. A
 * process that the host stopped itself, such as a question's, can still
 * write as it exits. */
export async function removeFolder(path: string) {
  const holders = await listHolders(join(path, "state", "agents"));
  await Promise.all(holders.map((info) => stopHolder(info)));
  await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
