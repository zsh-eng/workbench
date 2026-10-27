import { getLabRuntime } from "@/features/sync-lab/runtime";
import { useAuth } from "@/hooks/use-auth";
import { honoClient } from "@/lib/api";
import { getOrCreateDeviceId } from "@/lib/device";
import { SHARED_STORAGE_SUFFIX } from "@/lib/shared-api";
import type { DeviceType } from "@/types/session";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

/** A device that syncs this account, by the ID its records carry. */
export interface SyncDevice {
  clientId: string;
  /** "iPhone", "Mac", or "" when its user agent says too little. */
  label: string;
  deviceType: DeviceType | null;
  lastActiveAt: string | null;
}

export interface SyncDeviceNames {
  devices: readonly SyncDevice[];
  /** "this device", "your iPhone", or "another device". */
  name(deviceId: string | null): string;
  type(deviceId: string | null): DeviceType | null;
  /** This device's ID, as its records carry it. */
  localId: string;
}

const CACHE_KEY = "reader-sync-device-names-v1" + SHARED_STORAGE_SUFFIX;

/** A plain name from the user agent's OS and form, as Apple names its devices. */
export function deviceLabel(device: {
  os?: string | null;
  browser?: string | null;
  deviceType?: string | null;
  deviceName?: string | null;
}): string {
  if (device.deviceName) return device.deviceName;
  const os = (device.os ?? "").toLowerCase();
  const tablet = device.deviceType === "tablet";
  if (os.includes("ios")) return tablet ? "iPad" : "iPhone";
  if (os.includes("ipados")) return "iPad";
  if (os.includes("mac")) return "Mac";
  if (os.includes("android"))
    return tablet ? "Android tablet" : "Android phone";
  if (os.includes("windows")) return "Windows PC";
  if (os.includes("chrom")) return "Chromebook";
  if (os.includes("linux") || os.includes("ubuntu")) return "Linux computer";
  return "";
}

const deviceType = (value: unknown): DeviceType | null =>
  value === "mobile" || value === "tablet" || value === "desktop"
    ? value
    : null;

/**
 * Two devices with one name get their browsers: "iPhone (Chrome)". Two
 * that still match keep the name; the times beside them tell them apart.
 */
function distinguish(
  devices: { clientId: string; label: string; browser: string }[],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const device of devices) {
    const twins = devices.filter(
      (other) => other.label && other.label === device.label,
    );
    const browsers = new Set(twins.map((twin) => twin.browser));
    names.set(
      device.clientId,
      twins.length > 1 && browsers.size > 1 && device.browser
        ? `${device.label} (${device.browser})`
        : device.label,
    );
  }
  return names;
}

function readCache(): SyncDevice[] | undefined {
  try {
    const saved = localStorage.getItem(CACHE_KEY);
    return saved ? (JSON.parse(saved) as SyncDevice[]) : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(devices: SyncDevice[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(devices));
  } catch {
    // A full or blocked store names devices only while online.
  }
}

/**
 * Names for the devices that sync this account. Reader's Devices page lists
 * sign-in sessions, which carry no sync device ID; the server's device list
 * (`GET /api/devices`) is keyed by the `X-Device-ID` that records carry.
 * The names are remembered for offline use.
 */
export function useSyncDeviceNames(): SyncDeviceNames {
  const { user, isAuthenticated, isLoading } = useAuth();
  const userId = !isLoading && isAuthenticated ? user?.id : undefined;
  const { data } = useQuery({
    networkMode: "online",
    queryKey: ["sync-devices", userId],
    enabled: !!userId && !getLabRuntime(),
    initialData: readCache,
    initialDataUpdatedAt: 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SyncDevice[]> => {
      const response = await honoClient.api.devices.$get();
      if (!response.ok) throw new Error("Could not load devices");
      const { devices } = (await response.json()) as {
        devices: {
          clientId: string;
          deviceName?: string | null;
          browser?: string | null;
          os?: string | null;
          deviceType?: string | null;
          lastActiveAt?: string | null;
        }[];
      };
      const labels = distinguish(
        devices.map((device) => ({
          clientId: device.clientId,
          label: deviceLabel(device),
          browser:
            device.browser && device.browser !== "Unknown"
              ? device.browser.replace(/^Mobile /, "")
              : "",
        })),
      );
      const named = devices.map((device) => ({
        clientId: device.clientId,
        label: labels.get(device.clientId) ?? "",
        deviceType: deviceType(device.deviceType),
        lastActiveAt: device.lastActiveAt ?? null,
      }));
      writeCache(named);
      return named;
    },
  });
  return useMemo(() => {
    const localId = getOrCreateDeviceId();
    const devices = data ?? [];
    const byId = new Map(devices.map((device) => [device.clientId, device]));
    return {
      devices,
      localId,
      name(deviceId) {
        if (deviceId === null || deviceId === localId) return "this device";
        const label = byId.get(deviceId)?.label;
        return label ? `your ${label}` : "another device";
      },
      type(deviceId) {
        if (deviceId === null || deviceId === localId) return null;
        return byId.get(deviceId)?.deviceType ?? null;
      },
    };
  }, [data]);
}
