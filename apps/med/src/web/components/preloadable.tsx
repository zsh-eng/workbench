import { lazy, useState, type ComponentType } from "react";

/**
 * A lazy component that renders at once when its module is already loaded.
 * React.lazy suspends on its first render even then, and React then holds the
 * content for up to 300 ms after the fallback. Render it inside Suspense.
 */
export function preloadable<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  let loaded: ComponentType<P> | undefined;
  const preload = () => load().then((module) => (loaded = module.default));
  const Lazy = lazy(async () => ({ default: await preload() })) as unknown as ComponentType<P>;
  function Preloadable(props: P) {
    // Fixed for each instance, so its content never remounts.
    const [Inner] = useState(() => loaded ?? Lazy);
    return <Inner {...props} />;
  }
  return Object.assign(Preloadable, { preload: () => void preload() });
}
