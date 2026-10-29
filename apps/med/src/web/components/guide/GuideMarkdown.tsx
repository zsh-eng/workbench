import { lazy, Suspense } from "react";
import "../session/SessionThread.css";
import "./Guide.css";

// The Markdown renderer loads with the first summary, not with the review.
const SessionMarkdown = lazy(() =>
  import("../session/SessionMarkdown").then((module) => ({ default: module.SessionMarkdown })),
);

/** A guide's summary as Markdown, in the session's compact prose. */
export function GuideMarkdown({
  text,
  size = "body",
  onOpenLink,
}: {
  text: string;
  /** "table": a table of the Overview, as wide as its column. */
  size?: "body" | "lead" | "table";
  onOpenLink?(href: string): void;
}) {
  return (
    <div className={`med-guide-prose med-guide-${size}`}>
      <Suspense
        fallback={
          <div className="med-md-prose med-session-prose">
            <p className="med-session-plain">{text}</p>
          </div>
        }
      >
        <SessionMarkdown text={text} streaming={false} onOpenLink={onOpenLink} />
      </Suspense>
    </div>
  );
}
