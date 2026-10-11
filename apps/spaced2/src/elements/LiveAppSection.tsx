import { Button } from "@/components/ui/button";
import { useState } from "react";
import { DevicePair } from "./DeviceFrame";
import { ElementsSection } from "./ElementsLayout";

const PAGES = [
  { id: "/", label: "Review" },
  { id: "/decks", label: "Decks" },
  { id: "/create", label: "Create" },
  { id: "/stats", label: "Stats" },
  { id: "/profile", label: "Profile" },
] as const;

/**
 * The whole app in frames, last on the page. It uses this origin's cards and
 * starts background sync like any open tab, so it loads only on request.
 */
export function LiveAppSection() {
  const [page, setPage] = useState<string>();
  return (
    <ElementsSection
      id="live-app"
      title="Live app"
      description="The real app at each device size. These frames show this origin's cards and review history, and they sync like any open tab, so they load only when you choose a page."
    >
      <div className="flex flex-col gap-4">
        <div
          role="group"
          aria-label="Live app page"
          className="flex flex-wrap gap-2"
        >
          {PAGES.map((item) => (
            <Button
              key={item.id}
              variant={page === item.id ? "default" : "outline"}
              size="sm"
              aria-pressed={page === item.id}
              onClick={() => setPage(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        {page ? (
          <DevicePair key={page} src={page} title={`Live app, ${page}`} />
        ) : (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Choose a page to load the live app.
          </p>
        )}
      </div>
    </ElementsSection>
  );
}
