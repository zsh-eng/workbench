import * as stylex from "@stylexjs/stylex";
import { Menu } from "@base-ui/react/menu";
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Comparison } from "../../shared/protocol";
import { gitTargetsSchema, pushResultSchema, type GitTargets } from "../../shared/git-actions";
import { createApi } from "../data/api";
import { readBrowserToken } from "../data/auth";
import { ChoiceSelect } from "./Controls";
import { Icon } from "./Icon";
import { tokens, ui } from "../theme.stylex";

export function ComparisonActions({
  repo,
  head,
  sourceBranch,
  comparison,
  onCompare,
}: {
  repo: string;
  head: string;
  sourceBranch: string;
  comparison: Comparison;
  onCompare(base: string, head: string): void;
}) {
  const api = useMemo(() => createApi(fetch, readBrowserToken()), []);
  const [targets, setTargets] = useState<GitTargets>();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [pushOpen, setPushOpen] = useState(false);
  const [remote, setRemote] = useState("");
  const [branch, setBranch] = useState("");
  const pushBusy = useRef(false);
  const [pushing, setPushing] = useState(false);
  const [published, setPublished] = useState("");
  const [pushHead, setPushHead] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void api
      .json(`/api/git/targets?repo=${encodeURIComponent(repo)}`, gitTargetsSchema, {
        signal: abort.signal,
      })
      .then((value) => {
        if (!abort.signal.aborted) setTargets(value);
      })
      .catch((error: Error) => {
        if (!abort.signal.aborted) setError(error.message);
      });
    return () => abort.abort();
  }, [api, repo, head]);
  const commitHead = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(head) ? head : "";
  const destination = targets?.remotes.find((item) => item.name === remote);
  const existing = destination?.branches.includes(branch.trim());
  const refs =
    targets?.refs.filter((ref) => ref.label.toLowerCase().includes(query.toLowerCase())) ?? [];
  const publish = async () => {
    if (pushBusy.current) return;
    pushBusy.current = true;
    setPushing(true);
    setError("");
    try {
      const result = await api.json("/api/git/push", pushResultSchema, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo, head: pushHead, remote, branch: branch.trim() }),
      });
      setPublished(`Pushed ${result.head.slice(0, 8)} to ${result.remote}/${result.branch}`);
      setPushOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      pushBusy.current = false;
      setPushing(false);
    }
  };
  return (
    <>
      <Menu.Root
        onOpenChange={(open) => {
          if (open) setQuery("");
        }}
      >
        <Menu.Trigger {...stylex.props(ui.button)} aria-label="Compare against base branch">
          {comparison.kind === "range" && comparison.mergeBase
            ? `Base: ${comparison.base.replace(/^refs\/(heads|remotes)\//, "")}`
            : "Compare against"}
          <Icon name="chevron" size={12} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={6} {...stylex.props(styles.positioner)}>
            <Menu.Popup {...stylex.props(ui.popup, styles.menu)}>
              <input
                aria-label="Filter comparison branches"
                placeholder="Find a base branch"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                {...stylex.props(ui.input)}
              />
              <p {...stylex.props(styles.hint)}>Changes since the common ancestor</p>
              {refs.map((ref) => (
                <Menu.Item
                  key={ref.name}
                  onClick={() => onCompare(ref.name, commitHead)}
                  disabled={!commitHead}
                  className={(state) =>
                    stylex.props(ui.menuItem, state.highlighted && ui.menuHighlighted).className
                  }
                >
                  {ref.label}
                </Menu.Item>
              ))}
              {!targets && <p {...stylex.props(styles.hint)}>{error || "Loading branches…"}</p>}
              {targets && !refs.length && (
                <p {...stylex.props(styles.hint)}>No matching branches.</p>
              )}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <Dialog.Root
        open={pushOpen}
        onOpenChange={(open) => {
          if (pushBusy.current) return;
          if (open) {
            setError("");
            setPublished("");
            setPushHead(commitHead);
            setRemote(targets?.remotes[0]?.name ?? "");
            setBranch(sourceBranch);
          }
          setPushOpen(open);
        }}
      >
        <Dialog.Trigger {...stylex.props(ui.button)} disabled={!commitHead || !targets}>
          Push
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Backdrop {...stylex.props(styles.backdrop)} />
          <Dialog.Popup {...stylex.props(styles.dialog)}>
            <Dialog.Title {...stylex.props(styles.title)}>Push to remote</Dialog.Title>
            <Dialog.Description {...stylex.props(styles.hint)}>
              Publish commit {pushHead.slice(0, 8)} and its history. Uncommitted files are not
              included.
            </Dialog.Description>
            <p {...stylex.props(styles.repo)}>{repo}</p>
            {targets?.remotes.length ? (
              <>
                <div {...stylex.props(styles.field)}>
                  Remote
                  <ChoiceSelect
                    label="Push remote"
                    value={remote}
                    choices={targets.remotes.map((item) => ({
                      value: item.name,
                      label: item.name,
                    }))}
                    onChange={(value) => {
                      if (!pushBusy.current) setRemote(value);
                    }}
                  />
                </div>
                <label {...stylex.props(styles.field)}>
                  Destination branch
                  <input
                    aria-label="Destination branch"
                    value={branch}
                    disabled={pushing}
                    list="push-branches"
                    onChange={(event) => setBranch(event.target.value)}
                    {...stylex.props(ui.input)}
                  />
                </label>
                <datalist id="push-branches">
                  {destination?.branches.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </datalist>
                <p {...stylex.props(styles.hint)}>
                  {existing
                    ? "Update the existing branch."
                    : "Use an existing branch name or create a new branch."}{" "}
                  The push must be a fast-forward.
                </p>
              </>
            ) : (
              <p {...stylex.props(styles.hint)}>No remote is configured for this repository.</p>
            )}
            {error && (
              <p role="alert" {...stylex.props(styles.hint)}>
                {error}
              </p>
            )}
            <div {...stylex.props(styles.actions)}>
              <Dialog.Close {...stylex.props(ui.button)} disabled={pushing}>
                Cancel
              </Dialog.Close>
              <button
                {...stylex.props(ui.button, ui.strong)}
                disabled={pushing || !remote || !branch.trim()}
                onClick={() => void publish()}
              >
                {pushing ? "Pushing…" : `Push to ${remote || "remote"}`}
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      {published && (
        <span role="status" {...stylex.props(styles.hint)}>
          {published}
        </span>
      )}
    </>
  );
}
const styles = stylex.create({
  positioner: { zIndex: 105 },
  menu: { maxHeight: 380, overflowY: "auto", minWidth: 240, maxWidth: 460 },
  backdrop: { position: "fixed", inset: 0, backgroundColor: "#00000050", zIndex: 110 },
  dialog: {
    position: "fixed",
    top: "20vh",
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(440px, 90vw)",
    padding: 20,
    borderRadius: 16,
    backgroundColor: tokens.raised,
    color: tokens.text,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    boxShadow: tokens.shadow,
    zIndex: 111,
    outline: "none",
    fontFamily: tokens.ui,
  },
  title: { margin: 0, fontSize: 14, fontWeight: 600 },
  hint: { fontSize: 12, color: tokens.muted, lineHeight: 1.5 },
  repo: { fontSize: 12, overflowWrap: "anywhere", color: tokens.muted },
  field: { display: "flex", flexDirection: "column", gap: 6, marginBlock: 14, fontSize: 12 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 },
});
