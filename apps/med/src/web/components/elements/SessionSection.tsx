import * as stylex from "@stylexjs/stylex";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { readClaudeTranscript } from "../../../shared/agent-session-claude";
import { createSessionReplay } from "../../data/session-replay";
import { createSessionStore, type SessionStore } from "../../data/session-store";
import { tokens, ui } from "../../theme.stylex";
import { Icon } from "../Icon";
import { SessionThread } from "../session/SessionThread";
import { sessionGallery } from "./session-gallery";
import transcript from "./session-fixture.jsonl?raw";
import { Section, Specimen } from "./Specimen";

const SPEEDS = [1, 4, 16] as const;

function clock(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A frame like the secondary sidebar that will hold a session in Med. */
function Panel({
  title,
  store,
  now,
  children,
}: {
  title: string;
  store: SessionStore;
  now?: number;
  children?: ReactNode;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <div {...stylex.props(styles.panel)}>
      <header {...stylex.props(styles.panelHeader)}>
        <Icon name="claude" size={14} />
        <span {...stylex.props(styles.panelTitle)}>{snapshot.title ?? title}</span>
        <span
          aria-label={snapshot.running ? "Working" : "Idle"}
          {...stylex.props(styles.dot, snapshot.running && styles.dotLive)}
        />
      </header>
      <div {...stylex.props(styles.thread)}>
        <SessionThread snapshot={snapshot} now={now} />
      </div>
      {children}
    </div>
  );
}

function Replay() {
  const [{ store, replay }] = useState(() => {
    const store = createSessionStore();
    const replay = createSessionReplay(store, readClaudeTranscript(transcript));
    // The page opens on the whole session; Play starts it from the beginning.
    replay.seek(replay.getState().duration);
    return { store, replay };
  });
  useEffect(() => () => replay.dispose(), [replay]);
  const state = useSyncExternalStore(replay.subscribe, replay.getState);
  // Elapsed labels change in tenths of a second.
  const now = Math.floor(replay.clock() / 100) * 100;
  return (
    <div {...stylex.props(styles.replay)}>
      <div {...stylex.props(styles.controls)} role="toolbar" aria-label="Replay">
        <button
          type="button"
          onClick={() => (state.playing ? replay.pause() : replay.play())}
          aria-label={state.playing ? "Pause" : "Play"}
          {...stylex.props(ui.button, ui.outlined, styles.play)}
        >
          <Icon name={state.playing ? "pause" : "play"} size={13} />
          {state.playing ? "Pause" : state.position >= state.duration ? "Replay" : "Play"}
        </button>
        <input
          type="range"
          aria-label="Position"
          min={0}
          max={state.duration}
          step={100}
          value={state.position}
          onChange={(event) => replay.seek(Number(event.target.value))}
          {...stylex.props(styles.scrubber)}
        />
        <span {...stylex.props(styles.time)}>
          {clock(state.position)} / {clock(state.duration)}
        </span>
        <span role="group" aria-label="Speed" {...stylex.props(styles.speeds)}>
          {SPEEDS.map((speed) => (
            <button
              key={speed}
              type="button"
              aria-pressed={state.speed === speed}
              onClick={() => replay.setSpeed(speed)}
              {...stylex.props(ui.button, styles.speed, state.speed === speed && styles.speedOn)}
            >
              {speed}×
            </button>
          ))}
        </span>
      </div>
      <Panel title="Format trail durations" store={store} now={state.playing ? now : undefined}>
        <div {...stylex.props(styles.composer)} aria-hidden="true">
          Reply to Claude…
        </div>
      </Panel>
    </div>
  );
}

function Gallery() {
  const [store] = useState(() => {
    const store = createSessionStore();
    store.applyAll(sessionGallery());
    return store;
  });
  return <Panel title="Cache the branch list" store={store} />;
}

/**
 * Agent sessions in the thread that Med will show beside a review. The replay
 * reads a real Claude Code transcript with the same reader that will follow
 * live sessions, and plays it at the recorded pace.
 */
export function SessionSection() {
  return (
    <Section
      id="session"
      title="Agent session"
      lede="A Claude Code session, read from its transcript and played back at the recorded pace. Replies stream in token-sized chunks, as a live agent sends them. Click a row to see its command, output, or diff."
    >
      <Specimen
        title="Replay"
        note="A subagent adds formatDuration() to a small repository. Waits longer than 4 seconds play shorter."
        padded={false}
        zoomable={false}
        span="half"
      >
        <Replay />
      </Specimen>
      <Specimen
        title="Every part"
        note="Sample updates: a plan, a background shell, a failed test, a subagent, a notice, and a compaction."
        padded={false}
        zoomable={false}
        span="half"
      >
        <div {...stylex.props(styles.replay)}>
          <Gallery />
        </div>
      </Specimen>
    </Section>
  );
}

const styles = stylex.create({
  replay: { display: "flex", flexDirection: "column", height: 760 },
  controls: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    paddingBlock: 8,
    paddingInline: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  play: { minWidth: 84, gap: 6 },
  scrubber: { flex: "1", minWidth: 60, accentColor: tokens.accent },
  time: { color: tokens.muted, fontSize: 11.5, fontVariantNumeric: "tabular-nums" },
  speeds: { display: "flex", gap: 2 },
  speed: { minWidth: 32, paddingInline: 6, fontVariantNumeric: "tabular-nums" },
  speedOn: { color: tokens.text, backgroundColor: tokens.fill },
  panel: {
    flex: "1",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.canvas,
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 40,
    flexShrink: 0,
    paddingInline: 16,
    color: tokens.muted,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  panelTitle: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.text,
    fontSize: 12.5,
    fontWeight: 500,
  },
  dot: { width: 6, height: 6, borderRadius: "50%", backgroundColor: tokens.lineStrong },
  dotLive: { backgroundColor: tokens.green },
  thread: { flex: "1", minHeight: 0 },
  composer: {
    flexShrink: 0,
    marginInline: 12,
    marginBottom: 12,
    paddingBlock: 10,
    paddingInline: 12,
    borderRadius: `calc(10px * ${tokens.round})`,
    boxShadow: `inset 0 0 0 1px ${tokens.lineStrong}`,
    color: tokens.faint,
    fontSize: 12.5,
  },
});
