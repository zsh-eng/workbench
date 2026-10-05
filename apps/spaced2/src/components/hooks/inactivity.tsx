import { useEffect, useState } from "react";

const INACTIVITY_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
const DEBOUNCE_WAIT_MS = 1000; // 1 second

type UseActiveStartTimeOptions = {
  id?: string;
};

export function useActiveStartTime(
  options?: UseActiveStartTimeOptions,
): number {
  const [startTime, setStartTime] = useState(Date.now);

  useEffect(() => {
    let lastInteraction = Date.now();
    setStartTime(lastInteraction);
    if (!options?.id) return;

    let activityTimer: ReturnType<typeof setTimeout> | undefined;
    function handleUserActivity() {
      clearTimeout(activityTimer);
      activityTimer = setTimeout(() => {
        const now = Date.now();
        if (now - lastInteraction > INACTIVITY_THRESHOLD_MS) {
          setStartTime(now);
        }
        lastInteraction = now;
      }, DEBOUNCE_WAIT_MS);
    }

    function resetStartTime() {
      setStartTime(Date.now());
    }

    // Track user interactions
    const events = [
      "mousedown",
      "mousemove",
      "keydown",
      "scroll",
      "touchstart",
    ];

    events.forEach((event) => {
      window.addEventListener(event, handleUserActivity);
    });
    // When the user goes to another page and comes back, we should restart
    window.addEventListener("visibilitychange", resetStartTime);

    return () => {
      clearTimeout(activityTimer);
      events.forEach((event) => {
        window.removeEventListener(event, handleUserActivity);
      });
      window.removeEventListener("visibilitychange", resetStartTime);
    };
  }, [options?.id]);

  return startTime;
}
