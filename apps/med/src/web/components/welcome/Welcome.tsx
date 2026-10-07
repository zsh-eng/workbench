import * as stylex from "@stylexjs/stylex";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { tokens, ui } from "../../theme.stylex";
import { Icon } from "../Icon";
import { ShortcutKeys } from "../ShortcutKeys";
import {
  agentPrompt,
  createSetupApi,
  type Discovery,
  type FoundSource,
  type SetupApi,
  type SetupStatus,
  type SourceKind,
} from "../../data/setup";
import type { Pose, WelcomeScene } from "./scene";

type Step = "welcome" | "review" | "agents" | "workspaces" | "notes" | "setup" | "done";
type Feature = Exclude<Step, "welcome" | "setup" | "done">;
const STEPS: Step[] = ["welcome", "review", "agents", "workspaces", "notes", "setup", "done"];
/** The steps that the progress bar counts. */
const TOUR: Step[] = ["review", "agents", "workspaces", "notes", "setup"];

const FEATURES: Record<
  Feature,
  { eyebrow: string; title: string; body: ReactNode; hint: () => ReactNode; label: string }
> = {
  review: {
    eyebrow: "Review",
    label: "Review",
    title: "See every change clearly",
    body: "Working changes, commits, and branches in one calm view. Leave a note on any line, then copy every note back to your agent at once.",
    hint: () => (
      <>
        <ShortcutKeys value="Mod+K" /> Commands <span {...stylex.props(styles.hintGap)} />
        <ShortcutKeys value="?" /> Shortcuts
      </>
    ),
  },
  agents: {
    eyebrow: "Agents",
    label: "Agents",
    title: "Agents hand you their work",
    body: "An agent creates a review with a brief that cites its lines. It appears in your Med window, marked new, and your notes go back the same way.",
    hint: () => <code {...stylex.props(styles.code)}>med review create --open</code>,
  },
  workspaces: {
    eyebrow: "Workspaces",
    label: "Workspaces",
    title: "Every task, one key away",
    body: "Keep branches, saved reviews, and vaults open side by side. Each keeps its files, notes, and place.",
    hint: () => (
      <>
        <ShortcutKeys value="Mod+1" /> to <ShortcutKeys value="Mod+9" /> Show a workspace
        <span {...stylex.props(styles.hintGap)} />
        <ShortcutKeys value="Control+Tab" /> Previous
      </>
    ),
  },
  notes: {
    eyebrow: "Notes",
    label: "Notes",
    title: "Your notes, next to your code",
    body: "Read and edit Obsidian vaults with backlinks, wiki links, and the same Vim editor that you use on code.",
    hint: () => (
      <>
        <ShortcutKeys value="Mod+Shift+V" /> Preview Markdown
      </>
    ),
  },
};

const poseFor = (step: Step): Pose =>
  step === "welcome" ? "logo" : step === "setup" || step === "done" ? step : step;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Short relative time, such as 3d for three days ago. */
function since(time: number, now: number) {
  if (!time) return "";
  const minutes = Math.max(1, Math.round((now - time) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d`;
  if (days < 63) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}

/** A path as people know it: ~/code/med, or iCloud › Obsidian › Notes. */
export function displayPath(path: string, home?: string) {
  if (!home) return path;
  const cloud = `${home}/Library/Mobile Documents/`;
  if (path.startsWith(cloud)) {
    const [container = "", ...rest] = path.slice(cloud.length).split("/");
    const inside = rest[0] === "Documents" ? rest.slice(1) : rest;
    if (container === "com~apple~CloudDocs") return ["iCloud Drive", ...rest].join(" › ");
    if (container === "iCloud~md~obsidian") return ["iCloud", "Obsidian", ...inside].join(" › ");
    return ["iCloud", ...inside].join(" › ");
  }
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

const DAY = 86_400_000;
/** Recent sources start selected; a long tail of old checkouts does not. */
const RECENT = { repo: { days: 21, count: 10 }, vault: { days: 60, count: 6 } };

interface Row extends FoundSource {
  kind: SourceKind;
  state: "idle" | "added" | "adding" | "failed";
  /** Added since this page opened, by this page or by an agent. */
  fresh: boolean;
}

/** Setup data: registered sources (polled, so an agent's work shows up),
 * discovered candidates, the selection, and the login item. */
function useSetup(api: SetupApi, active: boolean) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<Record<string, "adding" | "failed">>({});
  const [initial, setInitial] = useState<Set<string> | null>(null);
  const started = useRef(false);

  const refresh = useCallback(async () => {
    const next = await api.status();
    setStatus(next);
    setInitial((current) => current ?? new Set(next.sources.map((source) => source.path)));
    return next;
  }, [api]);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const tick = () =>
      refresh().catch((reason) => {
        if (!stopped) setError(message(reason));
      });
    void tick();
    const timer = setInterval(tick, 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active, refresh]);

  const scan = useCallback(
    async (deep: boolean) => {
      setScanning(true);
      try {
        const found = await api.discover(deep);
        const now = Date.now();
        const recent = (list: FoundSource[], kind: SourceKind) =>
          list
            .filter((entry) => entry.activity > now - RECENT[kind].days * DAY)
            .slice(0, RECENT[kind].count)
            .map((entry) => entry.path);
        setDiscovery(found);
        setSelected(
          (current) =>
            new Set([
              ...current,
              ...recent(found.repositories, "repo"),
              ...recent(found.vaults, "vault"),
            ]),
        );
      } catch (reason) {
        setError(message(reason));
      } finally {
        setScanning(false);
      }
    },
    [api],
  );
  useEffect(() => {
    if (!active || started.current) return;
    started.current = true;
    void scan(false);
  }, [active, scan]);

  const rows = useMemo(() => {
    const registered = new Map(status?.sources.map((source) => [source.path, source]) ?? []);
    const build = (kind: SourceKind, found: FoundSource[]): Row[] => {
      const listed = new Set(found.map((entry) => entry.path));
      // Sources added elsewhere, such as by an agent, join the list.
      const extra = (status?.sources ?? [])
        .filter((source) => source.kind === kind && !listed.has(source.path))
        .map((source) => ({ path: source.path, name: source.name, activity: 0 }));
      return [...extra, ...found].map((entry) => {
        const added = registered.has(entry.path);
        return {
          ...entry,
          kind,
          state: added ? "added" : (pending[entry.path] ?? "idle"),
          fresh: added && !!initial && !initial.has(entry.path),
        };
      });
    };
    return {
      repo: build("repo", discovery?.repositories ?? []),
      vault: build("vault", discovery?.vaults ?? []),
    };
  }, [discovery, status, pending, initial]);

  const toggle = useCallback((path: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  /** Adds each selected source in turn; returns false if one failed. */
  const apply = useCallback(async () => {
    const todo = [...rows.repo, ...rows.vault].filter(
      (row) => selected.has(row.path) && row.state === "idle",
    );
    let ok = true;
    for (const row of todo) {
      setPending((current) => ({ ...current, [row.path]: "adding" }));
      try {
        await api.add(row.path, row.kind);
        await refresh();
        setPending((current) => {
          const next = { ...current };
          delete next[row.path];
          return next;
        });
      } catch (reason) {
        ok = false;
        setPending((current) => ({ ...current, [row.path]: "failed" }));
        setError(`${row.name}: ${message(reason)}`);
      }
    }
    return ok;
  }, [api, refresh, rows, selected]);

  const addPath = useCallback(
    async (path: string) => {
      setError("");
      const home = discovery?.home;
      const absolute = home && path.startsWith("~/") ? `${home}${path.slice(1)}` : path;
      await api.add(absolute);
      await refresh();
    },
    [api, discovery?.home, refresh],
  );

  const setLogin = useCallback(
    async (enabled: boolean) => {
      try {
        const login = await api.login(enabled);
        setStatus((current) => (current ? { ...current, login } : current));
      } catch (reason) {
        setError(message(reason));
      }
    },
    [api],
  );

  return {
    status,
    discovery,
    scanning,
    error,
    setError,
    rows,
    selected,
    toggle,
    scan,
    apply,
    addPath,
    setLogin,
  };
}

/**
 * Med's first-run flow: a short tour of what Med does, then one page that
 * registers repositories and vaults and opens Med at login. The same page
 * follows along when an agent does the setup from a copied prompt.
 */
export default function Welcome({
  api: provided,
  onFinish,
}: {
  api?: SetupApi;
  /** Leaves the welcome for an address in Med. */
  onFinish(url: string): void;
}) {
  const [api] = useState(() => provided ?? createSetupApi());
  const [step, setStep] = useState<Step>("welcome");
  const [flat, setFlat] = useState(false);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const scene = useRef<WelcomeScene | null>(null);
  const setup = useSetup(api, step === "setup" || step === "done");
  const index = STEPS.indexOf(step);
  const tourIndex = TOUR.indexOf(step);

  // The scene loads three.js; a browser without WebGL shows the icon instead.
  useEffect(() => {
    let stopped = false;
    let created: WelcomeScene | null = null;
    const root = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => root.getPropertyValue(name).trim() || fallback;
    void import("./scene")
      .then(({ createScene }) => {
        if (stopped || !canvas.current) return;
        created = createScene(canvas.current, {
          accent: read("--med-accent", "#8f9cff"),
          green: read("--med-green", "#82cfa1"),
          red: read("--med-red", "#ee8d98"),
        });
        scene.current = created;
        created.show("logo", anchor.current);
      })
      .catch(() => {
        if (!stopped) setFlat(true);
      });
    return () => {
      stopped = true;
      created?.dispose();
      scene.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    scene.current?.show(poseFor(step), anchor.current);
    heading.current?.focus({ preventScroll: true });
  }, [step]);

  const sources = useMemo(() => setup.status?.sources ?? [], [setup.status]);
  const chosen = [...setup.rows.repo, ...setup.rows.vault].filter(
    (row) => row.state === "added" || setup.selected.has(row.path),
  );
  const addedCount = sources.length;
  useEffect(() => {
    scene.current?.setSources(Math.max(chosen.length, addedCount), addedCount);
  }, [chosen.length, addedCount]);

  const go = useCallback((next: Step) => setStep(next), []);
  const next = useCallback(
    () => setStep((current) => STEPS[STEPS.indexOf(current) + 1] ?? current),
    [],
  );
  const back = useCallback(
    () => setStep((current) => STEPS[STEPS.indexOf(current) - 1] ?? current),
    [],
  );

  const finish = useCallback(() => {
    const repo = sources.find((source) => source.kind === "repo");
    const vault = sources.find((source) => source.kind === "vault");
    onFinish(repo ? "/" : vault ? `/vault/${vault.id}` : "/sources");
  }, [onFinish, sources]);

  const toAdd = chosen.filter((row) => row.state === "idle").length;
  const primary = useCallback(async () => {
    if (step === "done") return finish();
    if (step !== "setup") return next();
    setBusy(true);
    try {
      if (await setup.apply()) next();
    } finally {
      setBusy(false);
    }
  }, [finish, next, setup, step]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "Enter" && !target?.closest("button, a, [role='switch']")) {
        event.preventDefault();
        void primary();
      } else if (event.key === "ArrowRight" && step !== "setup" && step !== "done") {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft" && index > 0 && step !== "done") {
        event.preventDefault();
        back();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [back, index, next, primary, step]);

  // A drag on the object spins it.
  const drag = useRef<{ x: number; t: number } | null>(null);
  const stage = (size: stylex.StyleXStyles, fill?: number) => (
    <div
      ref={anchor}
      aria-hidden="true"
      data-welcome-stage={step}
      data-fill={fill}
      {...stylex.props(styles.stage, size)}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, t: event.timeStamp };
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const dx = event.clientX - drag.current.x;
        const dt = Math.max(event.timeStamp - drag.current.t, 8);
        scene.current?.nudge((dx / dt) * 0.9);
        drag.current = { x: event.clientX, t: event.timeStamp };
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      {flat && <img src="/icons/app-512.png" alt="" {...stylex.props(styles.flatIcon)} />}
    </div>
  );

  let content: ReactNode;
  if (step === "welcome")
    content = (
      <div key={step} {...stylex.props(styles.center)}>
        {stage(styles.heroStage, 0.92)}
        <div {...stylex.props(styles.enter)}>
          <h1 ref={heading} tabIndex={-1} {...stylex.props(styles.display)}>
            Welcome to Med
          </h1>
          <p {...stylex.props(styles.lede, styles.centerText)}>
            Read every change, yours and your agents', in one quiet place.
          </p>
          <div {...stylex.props(styles.actions)}>
            <button
              type="button"
              onClick={next}
              {...stylex.props(ui.button, ui.primary, styles.large)}
            >
              Get started{" "}
              <Icon name="arrowDown" size={14} style={{ transform: "rotate(-90deg)" }} />
            </button>
          </div>
          <button type="button" onClick={() => go("setup")} {...stylex.props(styles.quiet)}>
            Skip the tour
          </button>
        </div>
      </div>
    );
  else if (step === "setup")
    content = (
      <SetupPage
        key={step}
        setup={setup}
        stage={stage(styles.emblemStage, 0.9)}
        heading={heading}
        busy={busy}
      />
    );
  else if (step === "done")
    content = (
      <div key={step} {...stylex.props(styles.center)}>
        {stage(styles.heroStage, 0.92)}
        <div {...stylex.props(styles.enter)}>
          <h1 ref={heading} tabIndex={-1} {...stylex.props(styles.display)}>
            You're set
          </h1>
          <p {...stylex.props(styles.lede, styles.centerText)}>{summary(sources)}</p>
          <ul {...stylex.props(styles.tips)}>
            <li {...stylex.props(styles.tip)}>
              <ShortcutKeys value="Mod+K" />
              <span>Every command</span>
            </li>
            <li {...stylex.props(styles.tip)}>
              <ShortcutKeys value="?" />
              <span>Shortcuts</span>
            </li>
            <li {...stylex.props(styles.tip)}>
              <code {...stylex.props(styles.code)}>med review create</code>
              <span>Reviews from agents</span>
            </li>
          </ul>
          <div {...stylex.props(styles.actions)}>
            <button
              type="button"
              onClick={finish}
              {...stylex.props(ui.button, ui.primary, styles.large)}
            >
              Open Med
            </button>
          </div>
        </div>
      </div>
    );
  else {
    const feature = FEATURES[step];
    content = (
      <div key={step} {...stylex.props(styles.feature)}>
        <div {...stylex.props(styles.copy, styles.enter)}>
          <span {...stylex.props(styles.eyebrow)}>{feature.eyebrow}</span>
          <h1 ref={heading} tabIndex={-1} {...stylex.props(styles.title)}>
            {feature.title}
          </h1>
          <p {...stylex.props(styles.lede)}>{feature.body}</p>
          <p {...stylex.props(styles.hint)}>{feature.hint()}</p>
        </div>
        {stage(styles.featureStage)}
      </div>
    );
  }

  return (
    <div {...stylex.props(styles.root)} data-welcome={step}>
      <canvas ref={canvas} {...stylex.props(styles.canvas)} />
      <main {...stylex.props(styles.main)}>{content}</main>
      {tourIndex >= 0 && (
        <footer {...stylex.props(styles.bar)}>
          <button
            type="button"
            aria-label="Back"
            onClick={back}
            {...stylex.props(ui.button, ui.iconButton)}
          >
            <Icon name="chevron" size={14} style={{ transform: "rotate(90deg)" }} />
          </button>
          <nav aria-label="Welcome steps" {...stylex.props(styles.steps)}>
            {TOUR.map((entry, position) => (
              <button
                key={entry}
                type="button"
                aria-label={`Step ${position + 1}: ${entry === "setup" ? "Setup" : FEATURES[entry as Feature].label}`}
                aria-current={entry === step ? "step" : undefined}
                onClick={() => go(entry)}
                {...stylex.props(
                  styles.segment,
                  position < tourIndex && styles.segmentDone,
                  entry === step && styles.segmentCurrent,
                )}
              />
            ))}
          </nav>
          <span {...stylex.props(ui.grow)} />
          {step !== "setup" && (
            <button type="button" onClick={() => go("setup")} {...stylex.props(ui.button)}>
              Skip to setup
            </button>
          )}
          <button
            type="button"
            disabled={busy || setup.scanning}
            onClick={() => void primary()}
            {...stylex.props(ui.button, ui.primary, styles.continue)}
          >
            {step !== "setup"
              ? "Continue"
              : busy
                ? "Adding…"
                : toAdd
                  ? `Add ${toAdd} ${toAdd === 1 ? "source" : "sources"}`
                  : "Continue"}
          </button>
        </footer>
      )}
    </div>
  );
}

function summary(sources: SetupStatus["sources"]) {
  const repos = sources.filter((source) => source.kind === "repo").length;
  const vaults = sources.length - repos;
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (!sources.length) return "Add repositories and vaults any time from Sources.";
  const parts = [
    repos && count(repos, "repository", "repositories"),
    vaults && count(vaults, "vault", "vaults"),
  ];
  return `${parts.filter(Boolean).join(" and ")} ${sources.length === 1 ? "is" : "are"} ready to review.`;
}

function SetupPage({
  setup,
  stage,
  heading,
  busy,
}: {
  setup: ReturnType<typeof useSetup>;
  stage: ReactNode;
  heading: RefObject<HTMLHeadingElement | null>;
  busy: boolean;
}) {
  const { status, discovery, scanning, rows } = setup;
  const [copied, setCopied] = useState(false);
  const [watching, setWatching] = useState(false);
  const [prompt, setPrompt] = useState("");
  const fresh = [...rows.repo, ...rows.vault].filter((row) => row.fresh).length;

  const copy = async () => {
    if (!status) return;
    const text = agentPrompt(status, location.origin);
    setWatching(true);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Without clipboard access, show the prompt to copy by hand.
      setPrompt(text);
    }
  };

  return (
    <div {...stylex.props(styles.setup)}>
      <aside {...stylex.props(styles.setupIntro, styles.enter)}>
        {stage}
        <span {...stylex.props(styles.eyebrow)}>Setup</span>
        <h1 ref={heading} tabIndex={-1} {...stylex.props(styles.title)}>
          Make Med yours
        </h1>
        <p {...stylex.props(styles.lede)}>
          Choose the repositories and vaults that Med opens. Change them any time from Sources.
        </p>

        {status?.login.available && (
          <div {...stylex.props(styles.card)}>
            <div {...stylex.props(styles.cardText)}>
              <span id="welcome-login" {...stylex.props(styles.cardTitle)}>
                Open at login
              </span>
              <span {...stylex.props(styles.cardBody)}>
                Med starts in the background when you log in, so review links always open.
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={status.login.enabled}
              aria-labelledby="welcome-login"
              onClick={() => void setup.setLogin(!status.login.enabled)}
              {...stylex.props(styles.switch, status.login.enabled && styles.switchOn)}
            >
              <span {...stylex.props(styles.knob, status.login.enabled && styles.knobOn)} />
            </button>
          </div>
        )}

        <div {...stylex.props(styles.card, styles.agentCard)}>
          <div {...stylex.props(styles.cardText)}>
            <span {...stylex.props(styles.cardTitle)}>Or let an agent do it</span>
            <span {...stylex.props(styles.cardBody)}>
              Paste the prompt into Claude Code, Codex, or another agent that can run commands. It
              finds the projects you work in and asks before it adds them.
            </span>
          </div>
          <button
            type="button"
            disabled={!status}
            onClick={() => void copy()}
            {...stylex.props(ui.button, ui.outlined, styles.copyButton)}
          >
            <Icon name={copied ? "check" : "copy"} size={13} />
            {copied ? "Copied" : "Copy prompt"}
          </button>
          {watching && (
            <p role="status" {...stylex.props(styles.watching)}>
              <span {...stylex.props(styles.pulse)} />
              {fresh
                ? `${fresh} added so far. This page updates as your agent works.`
                : "Waiting for your agent. This page updates as it adds each one."}
            </p>
          )}
          {prompt && (
            <textarea
              readOnly
              aria-label="Setup prompt"
              value={prompt}
              onFocus={(event) => event.currentTarget.select()}
              {...stylex.props(ui.input, styles.promptText)}
            />
          )}
        </div>
      </aside>

      <section aria-label="Sources" {...stylex.props(styles.panel, styles.enterLate)}>
        {setup.error && (
          <p role="alert" {...stylex.props(styles.error)}>
            {setup.error}
          </p>
        )}
        <SourceList
          title="Repositories"
          kind="repo"
          rows={rows.repo}
          setup={setup}
          scanning={scanning && !discovery}
          disabled={busy}
          empty="No Git repositories in your home folder yet."
          footer={
            discovery?.skipped.length ? (
              <p {...stylex.props(styles.note)}>
                {discovery.skipped.join(", ")} not searched.{" "}
                <button
                  type="button"
                  disabled={scanning}
                  onClick={() => void setup.scan(true)}
                  {...stylex.props(styles.link)}
                >
                  {scanning ? "Searching…" : "Search them too"}
                </button>
              </p>
            ) : null
          }
        />
        <SourceList
          title="Obsidian vaults"
          kind="vault"
          rows={rows.vault}
          setup={setup}
          scanning={scanning && !discovery}
          disabled={busy}
          empty="No Obsidian vaults found."
        />
        <AddFolder onAdd={setup.addPath} home={discovery?.home} />
      </section>
    </div>
  );
}

const SHOWN = 7;

function SourceList({
  title,
  kind,
  rows,
  setup,
  scanning,
  disabled,
  empty,
  footer,
}: {
  title: string;
  kind: SourceKind;
  rows: Row[];
  setup: ReturnType<typeof useSetup>;
  scanning: boolean;
  disabled: boolean;
  empty: string;
  footer?: ReactNode;
}) {
  const [all, setAll] = useState(false);
  const [now] = useState(Date.now);
  const home = setup.discovery?.home;
  const shown = all ? rows : rows.slice(0, SHOWN);
  const added = rows.filter((row) => row.state === "added").length;
  const picked = rows.filter((row) => row.state === "idle" && setup.selected.has(row.path)).length;
  const short = (path: string) => displayPath(path, home);

  return (
    <div {...stylex.props(styles.section)} data-sources={kind}>
      <div {...stylex.props(styles.sectionHead)}>
        <h2 {...stylex.props(styles.sectionTitle)}>{title}</h2>
        <span {...stylex.props(styles.count)}>
          {scanning
            ? "Searching…"
            : [
                rows.length && `${rows.length} found`,
                added && `${added} added`,
                picked && `${picked} selected`,
              ]
                .filter(Boolean)
                .join(" · ")}
        </span>
      </div>
      {scanning ? (
        <div {...stylex.props(styles.rows)} aria-busy="true">
          {[0.62, 0.48, 0.7].map((width, index) => (
            <div key={index} {...stylex.props(styles.skeleton)}>
              <span {...stylex.props(styles.skeletonBox)} />
              <span
                {...stylex.props(styles.skeletonLine, styles.skeletonWidth(`${width * 100}%`))}
              />
            </div>
          ))}
        </div>
      ) : rows.length ? (
        <ul {...stylex.props(styles.rows)}>
          {shown.map((row) => {
            const checked = row.state === "added" || setup.selected.has(row.path);
            const locked = row.state !== "idle" || disabled;
            return (
              <li key={row.path} {...stylex.props(styles.item)}>
                <label
                  title={row.path}
                  data-state={row.state}
                  {...stylex.props(
                    styles.row,
                    locked && styles.rowLocked,
                    row.fresh && styles.rowFresh,
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={locked}
                    onChange={() => setup.toggle(row.path)}
                    {...stylex.props(styles.checkInput)}
                  />
                  <span
                    aria-hidden="true"
                    {...stylex.props(
                      styles.check,
                      checked && styles.checkOn,
                      row.state === "added" && styles.checkAdded,
                    )}
                  >
                    {checked && <Icon name="check" size={11} />}
                  </span>
                  <span {...stylex.props(styles.rowText)}>
                    <span {...stylex.props(styles.rowName)}>{row.name}</span>
                    <span {...stylex.props(styles.rowPath)}>
                      {short(row.path)}
                      {row.branch && <span {...stylex.props(styles.branch)}>{row.branch}</span>}
                    </span>
                  </span>
                  <span {...stylex.props(styles.rowMeta)}>
                    {row.state === "added" ? (
                      <span {...stylex.props(styles.addedLabel)}>Added</span>
                    ) : row.state === "adding" ? (
                      <span {...stylex.props(styles.spinner)} aria-label="Adding" />
                    ) : row.state === "failed" ? (
                      <span {...stylex.props(styles.failedLabel)}>Failed</span>
                    ) : (
                      since(row.activity, now)
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        <p {...stylex.props(styles.note)}>{empty}</p>
      )}
      {rows.length > SHOWN && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          {...stylex.props(styles.link, styles.more)}
        >
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
      {footer}
    </div>
  );
}

function AddFolder({ onAdd, home }: { onAdd(path: string): Promise<void>; home?: string }) {
  const [path, setPath] = useState("");
  const [state, setState] = useState<{ busy: boolean; error: string }>({ busy: false, error: "" });
  return (
    <form
      {...stylex.props(styles.addFolder)}
      onSubmit={(event) => {
        event.preventDefault();
        const value = path.trim();
        if (!value) return;
        setState({ busy: true, error: "" });
        onAdd(value).then(
          () => {
            setPath("");
            setState({ busy: false, error: "" });
          },
          (reason) => setState({ busy: false, error: message(reason) }),
        );
      }}
    >
      <label htmlFor="welcome-folder" {...stylex.props(styles.sectionTitle)}>
        Another folder
      </label>
      <div {...stylex.props(styles.addRow)}>
        <input
          id="welcome-folder"
          value={path}
          placeholder={home ? "~/path/to/repository-or-vault" : "/path/to/repository-or-vault"}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setPath(event.target.value)}
          {...stylex.props(ui.input, styles.addInput)}
        />
        <button
          type="submit"
          disabled={state.busy || !path.trim()}
          {...stylex.props(ui.button, ui.outlined)}
        >
          {state.busy ? "Adding…" : "Add"}
        </button>
      </div>
      {state.error && (
        <p role="alert" {...stylex.props(styles.error)}>
          {state.error}
        </p>
      )}
    </form>
  );
}

const rise = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(10px)" },
  to: { opacity: 1, transform: "none" },
});
const breathe = stylex.keyframes({
  "0%": { opacity: 0.35, transform: "scale(0.8)" },
  "50%": { opacity: 1, transform: "scale(1)" },
  "100%": { opacity: 0.35, transform: "scale(0.8)" },
});
const shimmer = stylex.keyframes({
  "0%": { opacity: 0.45 },
  "50%": { opacity: 0.9 },
  "100%": { opacity: 0.45 },
});
const spin = stylex.keyframes({ to: { transform: "rotate(360deg)" } });
const glow = stylex.keyframes({
  from: { backgroundColor: tokens.accentSoft },
  to: { backgroundColor: "transparent" },
});
const reduced = "@media (prefers-reduced-motion: reduce)";
const narrow = "@media (max-width: 860px)";

const styles = stylex.create({
  root: {
    position: "fixed",
    inset: 0,
    zIndex: 30,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    backgroundColor: tokens.canvas,
    // A soft light from above, like a studio backdrop.
    backgroundImage: `radial-gradient(120% 70% at 50% -10%, color-mix(in srgb, ${tokens.accent} 9%, transparent), transparent 62%), linear-gradient(180deg, transparent 55%, color-mix(in srgb, ${tokens.panel} 70%, transparent))`,
    color: tokens.text,
    fontFamily: tokens.ui,
  },
  canvas: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
  },
  main: {
    position: "relative",
    zIndex: 1,
    display: "flex",
    flexGrow: 1,
    minHeight: 0,
  },
  center: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    paddingInline: 24,
    paddingBottom: 48,
    textAlign: "center",
  },
  enter: {
    animationName: { default: rise, [reduced]: "none" },
    animationDuration: "520ms",
    animationTimingFunction: tokens.easeOut,
    animationFillMode: "both",
    animationDelay: "90ms",
  },
  enterLate: {
    animationName: { default: rise, [reduced]: "none" },
    animationDuration: "560ms",
    animationTimingFunction: tokens.easeOut,
    animationFillMode: "both",
    animationDelay: "180ms",
  },
  stage: {
    flexShrink: 0,
    display: "grid",
    placeItems: "center",
    cursor: { default: "grab", ":active": "grabbing" },
    touchAction: "none",
  },
  heroStage: {
    width: "min(44vh, 400px)",
    height: "min(44vh, 400px)",
    marginBottom: 12,
  },
  featureStage: {
    flexGrow: { default: 1, [narrow]: 0 },
    alignSelf: "stretch",
    height: { default: "auto", [narrow]: "38vh" },
    minHeight: { default: 280, [narrow]: 0 },
  },
  emblemStage: {
    width: 112,
    height: 112,
    marginInlineStart: -14,
    marginBottom: 6,
  },
  flatIcon: { width: "70%", height: "70%", objectFit: "contain" },
  display: {
    marginBlock: 0,
    fontSize: "clamp(36px, 5vw, 56px)",
    fontWeight: 600,
    letterSpacing: "-0.03em",
    lineHeight: 1.05,
    outline: "none",
  },
  title: {
    marginBlock: 0,
    fontSize: "clamp(30px, 3.6vw, 46px)",
    fontWeight: 600,
    letterSpacing: "-0.028em",
    lineHeight: 1.08,
    outline: "none",
    textWrap: "balance",
  },
  lede: {
    marginTop: 16,
    marginBottom: 0,
    maxWidth: 440,
    color: tokens.muted,
    fontSize: 16,
    lineHeight: 1.6,
    textWrap: "pretty",
  },
  centerText: { marginInline: "auto" },
  actions: { display: "flex", justifyContent: "center", gap: 8, marginTop: 30 },
  large: {
    minHeight: 40,
    paddingInline: 18,
    borderRadius: 10,
    fontSize: 14,
    gap: 8,
  },
  quiet: {
    marginTop: 14,
    paddingBlock: 4,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: "transparent",
    color: { default: tokens.faint, ":hover": tokens.muted },
    fontSize: 13,
    cursor: "pointer",
  },
  feature: {
    display: "flex",
    flexDirection: { default: "row", [narrow]: "column-reverse" },
    alignItems: "center",
    justifyContent: { default: "flex-start", [narrow]: "center" },
    width: "100%",
    gap: { default: 24, [narrow]: 8 },
    paddingInlineStart: { default: "clamp(28px, 8vw, 120px)", [narrow]: 28 },
    paddingInlineEnd: { default: "clamp(12px, 3vw, 48px)", [narrow]: 28 },
  },
  copy: {
    flexBasis: { default: 440, [narrow]: "auto" },
    flexShrink: 0,
    paddingBottom: { default: 40, [narrow]: 24 },
  },
  eyebrow: {
    display: "inline-flex",
    alignItems: "center",
    marginBottom: 18,
    paddingBlock: 3,
    paddingInline: 10,
    borderRadius: 999,
    backgroundColor: tokens.accentSoft,
    color: tokens.accent,
    fontSize: 12.5,
    fontWeight: 500,
    letterSpacing: "0.01em",
  },
  hint: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    marginTop: 26,
    marginBottom: 0,
    color: tokens.faint,
    fontSize: 12.5,
  },
  hintGap: { width: 12 },
  code: {
    paddingBlock: 3,
    paddingInline: 7,
    borderRadius: 6,
    backgroundColor: tokens.fill,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    color: tokens.muted,
    fontFamily: tokens.code,
    fontSize: 12,
  },
  tips: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 22,
    marginTop: 26,
    marginBottom: 0,
    paddingInlineStart: 0,
    listStyle: "none",
  },
  tip: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: tokens.faint,
    fontSize: 12.5,
  },
  bar: {
    position: "relative",
    zIndex: 2,
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
    height: 60,
    paddingInline: 16,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
    backgroundColor: `color-mix(in srgb, ${tokens.canvas} 88%, transparent)`,
  },
  steps: { display: "flex", alignItems: "center", gap: 4, marginInlineStart: 6 },
  segment: {
    width: 18,
    height: 18,
    paddingBlock: 0,
    paddingInline: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    cursor: "pointer",
    // The visible segment is a short rule inside a larger target.
    backgroundImage: `linear-gradient(${tokens.lineStrong}, ${tokens.lineStrong})`,
    backgroundSize: "100% 3px",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    transitionProperty: "width, background-image",
    transitionDuration: "320ms",
    transitionTimingFunction: tokens.easeOut,
  },
  segmentDone: {
    backgroundImage: `linear-gradient(${tokens.muted}, ${tokens.muted})`,
  },
  segmentCurrent: {
    width: 44,
    backgroundImage: `linear-gradient(${tokens.accent}, ${tokens.accent})`,
  },
  continue: { minHeight: 32, paddingInline: 14, borderRadius: 8 },
  setup: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(300px, 380px) minmax(0, 620px)",
      [narrow]: "minmax(0, 1fr)",
    },
    justifyContent: "center",
    alignItems: "start",
    gap: "clamp(28px, 5vw, 72px)",
    width: "100%",
    paddingInline: 28,
    paddingTop: "clamp(24px, 6vh, 64px)",
    paddingBottom: 24,
    overflowY: "auto",
  },
  setupIntro: { display: "flex", flexDirection: "column", alignItems: "flex-start" },
  card: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    width: "100%",
    boxSizing: "border-box",
    marginTop: 18,
    paddingBlock: 14,
    paddingInline: 16,
    borderRadius: 12,
    backgroundColor: tokens.fill,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
  },
  agentCard: { flexDirection: "column", alignItems: "flex-start", gap: 12 },
  cardText: { display: "flex", flexDirection: "column", gap: 4, flexGrow: 1 },
  cardTitle: { fontSize: 14, fontWeight: 500 },
  cardBody: { color: tokens.muted, fontSize: 13, lineHeight: 1.5 },
  copyButton: { gap: 7 },
  watching: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBlock: 0,
    color: tokens.muted,
    fontSize: 12.5,
  },
  pulse: {
    flexShrink: 0,
    width: 7,
    height: 7,
    borderRadius: "50%",
    backgroundColor: tokens.accent,
    animationName: { default: breathe, [reduced]: "none" },
    animationDuration: "1.6s",
    animationIterationCount: "infinite",
  },
  promptText: {
    height: 160,
    paddingBlock: 8,
    fontFamily: tokens.code,
    fontSize: 11.5,
    resize: "vertical",
  },
  switch: {
    position: "relative",
    flexShrink: 0,
    width: 36,
    height: 22,
    paddingBlock: 0,
    paddingInline: 0,
    borderWidth: 0,
    borderRadius: 999,
    backgroundColor: tokens.fillStrong,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: "200ms",
  },
  switchOn: { backgroundColor: tokens.accent, boxShadow: "none" },
  knob: {
    position: "absolute",
    top: 3,
    left: 3,
    width: 16,
    height: 16,
    borderRadius: "50%",
    backgroundColor: tokens.text,
    boxShadow: "0 1px 2px #0006",
    transitionProperty: "transform",
    transitionDuration: "220ms",
    transitionTimingFunction: tokens.easeOut,
  },
  knobOn: { transform: "translateX(14px)", backgroundColor: "#fff" },
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 26,
    minWidth: 0,
    paddingBottom: 32,
  },
  section: { display: "flex", flexDirection: "column", gap: 8 },
  sectionHead: { display: "flex", alignItems: "baseline", gap: 10 },
  sectionTitle: {
    marginBlock: 0,
    color: tokens.text,
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: "-0.005em",
  },
  count: { color: tokens.faint, fontSize: 12 },
  rows: {
    display: "flex",
    flexDirection: "column",
    marginBlock: 0,
    paddingInlineStart: 0,
    listStyle: "none",
    borderRadius: 12,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    overflow: "hidden",
  },
  row: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    paddingInline: 14,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: "140ms",
  },
  // A hairline between rows, none above the first.
  item: {
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  rowLocked: {
    cursor: "default",
    backgroundColor: { default: "transparent", ":hover": "transparent" },
  },
  rowFresh: {
    animationName: { default: glow, [reduced]: "none" },
    animationDuration: "1.8s",
    animationTimingFunction: tokens.easeOut,
  },
  checkInput: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    pointerEvents: "none",
  },
  check: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: 18,
    height: 18,
    borderRadius: 5,
    boxShadow: `inset 0 0 0 1.5px ${tokens.lineStrong}`,
    color: tokens.canvas,
    transitionProperty: "background-color, box-shadow",
    transitionDuration: "160ms",
  },
  checkOn: { backgroundColor: tokens.accent, boxShadow: "none" },
  checkAdded: { backgroundColor: tokens.green },
  rowText: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flexGrow: 1 },
  rowName: {
    fontSize: 14,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  rowPath: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    overflow: "hidden",
    color: tokens.faint,
    fontSize: 12,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  branch: {
    flexShrink: 0,
    color: tokens.muted,
    fontFamily: tokens.code,
    fontSize: 11,
  },
  rowMeta: {
    flexShrink: 0,
    minWidth: 32,
    color: tokens.faint,
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
    textAlign: "right",
  },
  addedLabel: { color: tokens.green, fontWeight: 500 },
  failedLabel: { color: tokens.red, fontWeight: 500 },
  spinner: {
    display: "inline-block",
    width: 12,
    height: 12,
    borderRadius: "50%",
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    borderTopColor: tokens.accent,
    animationName: spin,
    animationDuration: "700ms",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  skeleton: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    height: 48,
    paddingInline: 14,
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
    animationName: { default: shimmer, [reduced]: "none" },
    animationDuration: "1.4s",
    animationIterationCount: "infinite",
  },
  skeletonBox: { width: 18, height: 18, borderRadius: 5, backgroundColor: tokens.fillStrong },
  skeletonLine: { height: 10, borderRadius: 5, backgroundColor: tokens.fillStrong },
  skeletonWidth: (width: string) => ({ width }),
  note: { marginBlock: 0, color: tokens.faint, fontSize: 12.5, lineHeight: 1.5 },
  link: {
    paddingBlock: 0,
    paddingInline: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: { default: tokens.accent, ":hover": tokens.text },
    fontSize: 12.5,
    cursor: "pointer",
  },
  more: { alignSelf: "flex-start" },
  addFolder: { display: "flex", flexDirection: "column", gap: 8 },
  addRow: { display: "flex", gap: 8 },
  addInput: { height: 32, fontSize: 13 },
  error: { marginBlock: 0, color: tokens.red, fontSize: 12.5, lineHeight: 1.5 },
});
