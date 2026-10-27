import type { SyncHistoryGroup } from "@zsh-eng/local-sync";
import { formatDistanceToNow } from "date-fns";
import { useSyncDeviceNames } from "./device-names";
import { DeviceIcon, GroupItems, span } from "./RecentHistory";
import { useReaderSyncHistory } from "./use-reader-sync-history";

interface DeviceRow {
  id: string;
  name: string;
  deviceType: Parameters<typeof DeviceIcon>[0]["type"];
  lastActiveAt: string | null;
  last: SyncHistoryGroup | undefined;
}

/**
 * Devices, behind Debug: the devices that sync this account, by the ID
 * their changes carry, each with the last changes this device has from
 * it. This device shows what it last sent.
 */
export function SyncDevices() {
  const history = useReaderSyncHistory();
  const names = useSyncDeviceNames();
  const sent = history.groups.find((group) => group.direction === "sent");
  const rows: DeviceRow[] = names.devices.map((device) => ({
    id: device.clientId,
    name:
      device.clientId === names.localId
        ? "This device"
        : device.label || "Another device",
    deviceType: device.deviceType,
    lastActiveAt: device.lastActiveAt,
    last:
      device.clientId === names.localId
        ? sent
        : history.lastFrom.get(device.clientId),
  }));
  // Devices this one has heard from that the server no longer lists.
  for (const [deviceId, group] of history.lastFrom)
    if (!rows.some((row) => row.id === deviceId))
      rows.push({
        id: deviceId,
        name: "Another device",
        deviceType: null,
        lastActiveAt: null,
        last: group,
      });
  rows.sort(
    (a, b) =>
      Number(b.id === names.localId) - Number(a.id === names.localId) ||
      (b.last?.to ?? 0) - (a.last?.to ?? 0),
  );

  return (
    <section data-sync-devices="">
      <h2 className="mb-2 ml-1 text-xs font-medium tracking-wider text-balance text-muted-foreground uppercase">
        Syncing devices
      </h2>
      <p className="mb-3 ml-1 text-xs text-muted-foreground">
        Debug. Each device's latest changes that reached this one, from this
        device's sync history.
      </p>
      {!history.loaded ? (
        <p className="ml-1 text-sm text-muted-foreground">Reading…</p>
      ) : rows.length === 0 ? (
        <p className="ml-1 text-sm text-muted-foreground">
          No devices yet. They show once the server lists them.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-3xl bg-muted px-2 py-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-start gap-4 p-4"
              data-sync-device={row.id}
            >
              <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground">
                <DeviceIcon type={row.deviceType} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {row.name}
                  </span>
                  {row.lastActiveAt && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(row.lastActiveAt), {
                        addSuffix: true,
                      })}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
                  {row.last ? (
                    <>
                      {row.id === names.localId ? "Sent" : "Last sent"}{" "}
                      {span(row.last.from, row.last.to)} ·{" "}
                      <GroupItems items={row.last.items} capital={false} />
                    </>
                  ) : row.id === names.localId ? (
                    "Has sent nothing in the last 30 days."
                  ) : (
                    "Nothing from it here in the last 30 days."
                  )}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
