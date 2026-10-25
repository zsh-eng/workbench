import { appUpdateStore, getAppUpdate } from "@/lib/app-update";
import { activity } from "@/lib/background-activity";
import type { ActivityManager } from "@workbench/background-activity";
import type { AppUpdateState } from "@workbench/background-activity/service-worker";
import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export interface UpdateStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): AppUpdateState;
  /** When this page, or the simulated one, started. */
  startedAt: number;
}

/** What the background parts do with jobs. */
export type ActivityControls = Pick<
  ActivityManager,
  "subscribe" | "getSnapshot" | "cancel" | "retry" | "dismiss"
>;

/**
 * Where the background parts read their work from. The app reads the real
 * queue and update; Design ideas runs the same engine on simulated jobs.
 */
export interface ActivityEnvironment {
  source: ActivityControls;
  update: UpdateStore;
  restart(): void;
}

const appEnvironment: ActivityEnvironment = {
  source: activity,
  update: { ...appUpdateStore, startedAt: Date.now() },
  restart: () => getAppUpdate()?.apply(),
};

const ActivityEnvironmentContext =
  createContext<ActivityEnvironment>(appEnvironment);

export function ActivityEnvironmentProvider({
  value,
  children,
}: {
  value: ActivityEnvironment;
  children: ReactNode;
}) {
  return (
    <ActivityEnvironmentContext.Provider value={value}>
      {children}
    </ActivityEnvironmentContext.Provider>
  );
}

export function useActivityEnvironment(): ActivityEnvironment {
  return useContext(ActivityEnvironmentContext);
}

export function useUpdateState(): AppUpdateState {
  const { update } = useActivityEnvironment();
  return useSyncExternalStore(
    update.subscribe,
    update.getSnapshot,
    update.getSnapshot,
  );
}
