import * as stylex from "@stylexjs/stylex";
import { lazy, Suspense, useState } from "react";
import { tokens, ui } from "../../theme.stylex";
import { createFakeRepository, type CommitSwitches } from "./commit-fixture";
import { Section, Specimen } from "./Specimen";

const CommitView = lazy(() => import("../CommitView"));

const labels: Record<keyof CommitSwitches, string> = {
  upstream: "Branch has an upstream",
  hookFails: "Pre-commit hook fails",
  pushRejected: "Remote rejects the push",
  slow: "Slow Git",
};

/** The Commit tab on an in-memory repository, with switches for each failure. */
export function CommitSection() {
  const [switches, setSwitches] = useState<CommitSwitches>({
    upstream: true,
    hookFails: false,
    pushRejected: false,
    slow: false,
  });
  const [repository] = useState(() => createFakeRepository(switches));
  // A reset reads the repository again; the view keeps its message draft.
  const [revision, setRevision] = useState(0);
  return (
    <Section
      id="commit"
      title="Commit flow"
      lede="The Commit tab (q in a review) on a pretend repository: staging, commits, and pushes change only this page. Click inside the view to use its keys."
    >
      <Specimen
        title="Commit tab"
        note="j/k move, Space stages a file, a stages all, / filters, c writes the message, ⌘↵ commits, ⇧P pushes."
        padded={false}
        zoomable={false}
      >
        <div {...stylex.props(styles.controls)}>
          {(Object.keys(labels) as (keyof CommitSwitches)[]).map((key) => (
            <label key={key} {...stylex.props(styles.switch)}>
              <input
                type="checkbox"
                checked={switches[key]}
                onChange={(event) => {
                  const next = { ...switches, [key]: event.target.checked };
                  repository.configure(next);
                  setSwitches(next);
                  // The branch's upstream shows in the view's header.
                  setRevision((value) => value + 1);
                }}
              />
              {labels[key]}
            </label>
          ))}
          <span {...stylex.props(ui.grow)} />
          <button
            type="button"
            onClick={() => {
              repository.reset();
              setRevision((value) => value + 1);
            }}
            {...stylex.props(ui.button, styles.reset)}
          >
            Reset repository
          </button>
        </div>
        <div {...stylex.props(styles.frame)}>
          <Suspense fallback={null}>
            <CommitView api={repository.api} revision={revision} active keys="view" />
          </Suspense>
        </div>
      </Specimen>
    </Section>
  );
}

const styles = stylex.create({
  controls: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 14,
    paddingBlock: 10,
    paddingInline: 14,
    fontSize: 12.5,
    color: tokens.muted,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  switch: { display: "flex", alignItems: "center", gap: 6 },
  reset: { height: 26, paddingInline: 10, fontSize: 12 },
  frame: { height: 560 },
});
