import * as stylex from "@stylexjs/stylex";
import { lazy, Suspense, useState } from "react";
import { briefMarkdown } from "./brief-fixture";
import { Section, Specimen } from "./Specimen";

const BriefView = lazy(() => import("../BriefView"));
const noop = () => {};

export function BriefSection() {
  const [brief] = useState(() => ({ text: briefMarkdown(), updatedAt: "2026-10-09T09:00:00Z" }));
  return (
    <Section
      id="brief"
      title="Brief"
      lede="A sample brief in the real brief view: headings, lists, code, a table, an image, and Mermaid diagrams. Widen the window to see code, images, and tables reach past the text column."
    >
      <Specimen
        title="Brief"
        note="Text column, wide blocks, and diagrams in the current theme."
        padded={false}
        zoomable={false}
      >
        <div {...stylex.props(styles.frame)}>
          <Suspense fallback={null}>
            <BriefView
              brief={brief}
              files={[]}
              active={false}
              loadSource={async () => ({ old: "", new: "" })}
              onOpen={noop}
              onOpenPath={noop}
              onPaste={noop}
              onCopy={noop}
              onRemove={noop}
              notes={[]}
              onMutateNote={async () => {}}
            />
          </Suspense>
        </div>
      </Specimen>
    </Section>
  );
}

const styles = stylex.create({
  // The whole brief shows; in the app it scrolls inside its pane.
  frame: { display: "flex", flexDirection: "column" },
});
