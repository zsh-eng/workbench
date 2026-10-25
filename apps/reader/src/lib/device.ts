import { getLabRuntime, getRuntimeStorage } from "@/features/sync-lab/runtime";
/**
 * Key for storing the device ID in localStorage.
 * The device ID is a UUID that uniquely identifies this browser instance.
 *
 * This is separate from user sessions:
 * - Device ID: Persists forever in localStorage, survives logout/login
 * - Session: Authentication token, rotates on login/logout
 *
 * The device ID is used for:
 * - Tracking reading progress across devices
 * - Conflict resolution in sync (last-write-wins by device)
 * - Displaying "other devices" to the user
 */
const DEVICE_ID_KEY = "epub-reader-device-id";

/**
 * Gets or creates a persistent device ID stored in localStorage.
 * This ID is stable across sessions and used to identify this specific browser/device.
 *
 * The device ID is automatically sent with all API requests via the X-Device-ID header.
 * The server will register/update the device in the database for authenticated users.
 *
 * @returns A UUID string that uniquely identifies this browser instance
 */
export function getOrCreateDeviceId(): string {
  const lab = getLabRuntime();
  if (lab) return lab.deviceId;
  let deviceId = getRuntimeStorage().getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    getRuntimeStorage().setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}
