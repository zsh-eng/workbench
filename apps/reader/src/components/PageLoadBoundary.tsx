import { Component, type ReactNode } from "react";

/**
 * Shows a reload in place of a page that failed, such as a Debug page opened
 * offline before its first visit: the service worker keeps those pages only
 * after they have downloaded once.
 */
export class PageLoadBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 md:px-6 md:py-10">
        <h1 className="text-2xl font-bold tracking-tight">
          This page couldn’t open
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {navigator.onLine
            ? "Reload to try again."
            : "It downloads the first time you open it. Connect to the internet, then reload."}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 inline-block text-sm underline underline-offset-4"
        >
          Reload
        </button>
      </div>
    );
  }
}
