import * as stylex from "@stylexjs/stylex";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  dashboardPath,
  dashboardRoutes,
  inputValues,
  followsRange,
  listed,
  panelChartText,
  panelTitle,
  sourceName,
  substitute,
  valuesOfSearch,
  type Dashboard,
  type DashboardEntry,
  type DashboardFile,
  type DashboardHistoryEntry,
  type DashboardInput,
  type DashboardPanel,
} from "../../../shared/dashboards";
import { isRelative, momentRange, rangeLabel, type TimeRange } from "../../../shared/time-range";
import { useDocumentTitle } from "../../data/document-title";
import {
  dashboardIdOf,
  keptDashboard,
  keptDashboards,
  listDashboards,
  openDashboards,
  readDashboard,
} from "../../data/dashboards";
import { relativeTime } from "../../data/relative-time";
import { tokens, ui } from "../../theme.stylex";
import { createApi } from "../../data/api";
import { readBrowserToken } from "../../data/auth";
import { browserFetch } from "../../data/live";
import { ChartBlock, ChartZoom, chartSourceName } from "../chart/ChartBlock";
import { OnBoard } from "../chart/chart-board";
import { SharedCursor } from "../chart/chart-cursor";
import { ActionMenu, ChoiceSelect, SearchSelect } from "../Controls";
import { AskSuperagent } from "./AskSuperagent";
import { InputHistory } from "./InputHistory";
import {
  agentShowed,
  keepInHistory,
  noteAgentShow,
  readHistory,
} from "../../data/dashboard-history";
import { useThreadDashboards, valuesInWords } from "../session/DashboardLinkCard";
import { TimeRangePicker } from "./TimeRangePicker";
import { Icon } from "../Icon";
import { SessionMarkdown } from "../session/SessionMarkdown";
import { settingStyles } from "../settings/SettingsParts";
import { ToolButton } from "../ToolButton";
import { PaneHeader } from "../PaneTree";

// Dashboards: YAML files that open as pages, as Obsidian's Bases do
// (shared/dashboards.ts has the format). The list shows each file Med found;
// a dashboard shows its inputs, its views as tabs, and its panels on a grid
// of twelve columns. The inputs, the range and the view live in the address
// (?var-service=checkout&from=now-6h&to=now&view=Errors), so a link opens the
// same dashboard, and Back undoes a change: an input, a range, a drag across
// a chart that zooms the whole page to its time. The file is read again every
// few seconds while it shows, so an agent's edit draws as it lands.
//
// The reader can ask the Superagent instead of clicking: the page tells the
// host what it shows, and `med dashboard open` changes it in place.

/** While a dashboard shows, its file is read again this often. */
const FILE_EVERY = 2_000;
/** While the list shows, it is read again this often. */
const LIST_EVERY = 10_000;

function useAddress() {
  const [address, setAddress] = useState(() => `${location.pathname}${location.search}`);
  useEffect(() => {
    const follow = () => setAddress(`${location.pathname}${location.search}`);
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);
  return address;
}

export function DashboardsPage() {
  useAddress();
  const id = dashboardIdOf(location.pathname);
  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.scroller)}>
        {id ? <DashboardView key={id} id={id} /> : <DashboardList />}
      </div>
    </div>
  );
}

/** A dashboard beside a thread, at the address that a reply linked to or
 * that its agent showed; the reader's changes move the pane's own address.
 * Its header lists the thread's other dashboards, as the thread's rail does. */
export function DashboardPane({
  path,
  thread,
  controls,
  onPath,
}: {
  path: string;
  thread: string;
  controls: ReactNode;
  /** `step`: a change that Back undoes. */
  onPath(path: string, step: boolean): void;
}) {
  const query = path.indexOf("?");
  const id = dashboardIdOf(query < 0 ? path : path.slice(0, query));
  const values = useMemo(() => valuesOfSearch(query < 0 ? "" : path.slice(query)), [path, query]);
  const linked = useThreadDashboards(thread);
  const scroller = useRef<HTMLDivElement>(null);
  return (
    <div data-dashboard-pane="" {...stylex.props(styles.pane)}>
      <PaneHeader
        title="Dashboard"
        detail={
          linked.length > 0 ? (
            <ActionMenu
              label="This thread's dashboards"
              align="start"
              trigger={[ui.button, styles.paneMenu]}
              sections={[
                linked.map((link) => ({
                  label: link.title,
                  hint: valuesInWords(link.path),
                  checked: link.path === path,
                  choice: true,
                  onClick: () => {
                    if (link.path === path) return;
                    noteAgentShow(link.path);
                    scroller.current?.scrollTo({ top: 0 });
                    onPath(link.path, true);
                  },
                })),
              ]}
            >
              {linked.length === 1 ? "1 in this thread" : `${linked.length} in this thread`}
              <Icon name="chevron" size={12} />
            </ActionMenu>
          ) : undefined
        }
        controls={
          <>
            <ToolButton
              label="Open as a page"
              icon="external"
              onClick={() => {
                history.pushState(null, "", path);
                window.dispatchEvent(new PopStateEvent("popstate"));
              }}
            />
            {controls}
          </>
        }
      />
      <div ref={scroller} {...stylex.props(styles.scroller)}>
        <DashboardView
          key={id}
          id={id}
          embedded={{ values, onValues: (next, step) => onPath(dashboardPath(id, next), step) }}
        />
      </div>
    </div>
  );
}

function DashboardList() {
  useDocumentTitle("Dashboards");
  const [list, setList] = useState(keptDashboards);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now);
  const read = async (signal?: AbortSignal) => {
    setBusy(true);
    try {
      setList(await listDashboards(signal));
      setError("");
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (!signal?.aborted) setBusy(false);
      setNow(Date.now());
    }
  };
  useEffect(() => {
    const abort = new AbortController();
    const first = setTimeout(() => void read(abort.signal));
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void read(abort.signal);
    }, LIST_EVERY);
    return () => {
      abort.abort();
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  const groups = new Map<string, DashboardEntry[]>();
  for (const entry of list?.dashboards ?? [])
    groups.set(entry.where, [...(groups.get(entry.where) ?? []), entry]);
  return (
    <div {...stylex.props(styles.listColumn)}>
      <div {...stylex.props(styles.heading)}>
        <h1 {...stylex.props(styles.pageTitle)}>Dashboards</h1>
        <ToolButton
          label="Find dashboards again"
          icon="refresh"
          busy={busy}
          onClick={() => void read()}
        />
      </div>
      <p {...stylex.props(styles.lead)}>
        A dashboard is a <code {...stylex.props(styles.code)}>.dashboard.yaml</code> file that opens
        as its own page, as an Obsidian Base does: inputs, views, and panels whose data a chart
        source prints. Med finds them in your repositories and in{" "}
        <code {...stylex.props(styles.code)}>{list?.folder ?? "its dashboards folder"}</code>.
      </p>
      {error && (
        <p role="alert" {...stylex.props(styles.problem)}>
          {error}
        </p>
      )}
      {list && !list.dashboards.length && (
        <div {...stylex.props(styles.empty)}>
          <p {...stylex.props(styles.emptyTitle)}>No dashboards yet</p>
          <p {...stylex.props(styles.emptyNote)}>
            Ask an agent for one: it writes the file, checks it with{" "}
            <code {...stylex.props(styles.code)}>med dashboard check</code>, and it shows here.{" "}
            <code {...stylex.props(styles.code)}>med docs dashboards</code> has the format.
          </p>
        </div>
      )}
      {[...groups].map(([where, entries]) => (
        <section key={where} aria-label={where} {...stylex.props(styles.section)}>
          <h2 {...stylex.props(styles.sectionTitle)}>
            {where}
            <span {...stylex.props(styles.count)}>{entries.length}</span>
          </h2>
          <div {...stylex.props(styles.card)}>
            {entries.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                {...stylex.props(styles.row, index === 0 && styles.firstRow)}
                onClick={() => openDashboards(entry.id)}
              >
                <span {...stylex.props(styles.rowIcon)}>
                  <Icon name="display" size={16} />
                </span>
                <span {...stylex.props(styles.rowText)}>
                  <span {...stylex.props(styles.rowTitle)}>{entry.title}</span>
                  <span {...stylex.props(styles.rowFacts)}>
                    {entry.problem ? (
                      <span {...stylex.props(styles.rowProblem)}>{entry.problem}</span>
                    ) : (
                      (entry.description ?? entry.relative)
                    )}
                  </span>
                </span>
                <span {...stylex.props(styles.rowEnd)}>
                  {entry.panels} panel{entry.panels === 1 ? "" : "s"}
                  {entry.views > 1 ? ` · ${entry.views} views` : ""}
                  <span {...stylex.props(styles.rowWhen)}>{relativeTime(entry.modified, now)}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The page tells the host what it shows, so `med dashboard` can say it. */
function report(id: string, values: Record<string, string>, showing: boolean) {
  void createApi(browserFetch, readBrowserToken())
    .call(dashboardRoutes.report, { id, values, showing })
    .catch(() => {});
}

/** What the page shows, for the Superagent: the values, and how to change them. */
function pageContext(
  id: string,
  dashboard: Dashboard,
  values: Record<string, string>,
  range: TimeRange | undefined,
  view: string | undefined,
) {
  const shown = [
    ...dashboard.inputs.map((input) => `${input.name}=${values[input.name] ?? input.default}`),
    ...(range ? [`${rangeLabel(range)} (from ${range.from} to ${range.to})`] : []),
    ...(view && dashboard.views.length > 1 ? [`view ${view}`] : []),
  ].join(", ");
  const inputs = dashboard.inputs
    .map((input) =>
      input.options?.length
        ? `${input.name} (${listed(input.options)}${input.source ? `, from ${sourceName(input.source)}` : ""})`
        : input.name,
    )
    .join(", ");
  return [
    `${dashboard.title} (${id}) is on the reader's screen in Med${shown ? `: ${shown}` : ""}.`,
    inputs ? `Its inputs: ${inputs}.` : "",
    dashboard.views.length > 1
      ? `Its views: ${dashboard.views.map((entry) => entry.name).join(", ")}.`
      : "",
    `To change what it shows, run med dashboard open with only what changes: --set name=value, --range "<words>" (6h, yesterday, "yesterday 12:00 to 18:00", "since 9:00"), --view <name>. To answer what it shows, run med dashboard check with the same flags: it reads every panel as the page does. Say what you changed in a sentence.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The minute that every panel reads as of, so the panels agree. */
const minute = () => Math.floor(Date.now() / 60_000) * 60_000;

/** A dashboard in a pane beside a thread: its values are the pane's, not the
 * address's, and the thread's message box is where to ask. */
interface Embedded {
  values: Record<string, string>;
  /** `step`: a change that Back undoes, as an input's or the range's. */
  onValues(values: Record<string, string>, step: boolean): void;
}

function DashboardView({ id, embedded }: { id: string; embedded?: Embedded }) {
  const [file, setFile] = useState<DashboardFile | undefined>(() => keptDashboard(id));
  const [error, setError] = useState("");
  const [ownGiven, setGiven] = useState(() => valuesOfSearch(location.search));
  const given = embedded ? embedded.values : ownGiven;
  const [at, setAt] = useState(minute);
  const [source, setSource] = useState(false);
  useDocumentTitle(file?.dashboard?.title ?? file?.entry.title ?? "Dashboard", 0, !embedded);

  // The file, again every few seconds while it shows: an agent's edit draws.
  useEffect(() => {
    const abort = new AbortController();
    let last = "";
    const read = async () => {
      try {
        const next = await readDashboard(id, abort.signal);
        // The file, or the options that its inputs read from elsewhere.
        const seen = JSON.stringify([next.text, next.dashboard?.inputs, next.problems]);
        if (seen !== last) {
          last = seen;
          setFile(next);
        }
        setError("");
      } catch (reason) {
        if (!abort.signal.aborted)
          setError(reason instanceof Error ? reason.message : String(reason));
      }
    };
    void read();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void read();
    }, FILE_EVERY);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [id]);
  // Back and forward move between the values, as an agent's change does.
  useEffect(() => {
    if (embedded) return;
    const follow = () => setGiven(valuesOfSearch(location.search));
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, [embedded]);
  /** New values: an input or the range is a step that Back undoes; a view is not. */
  const change = (next: Record<string, string>, step = true) => {
    const merged = { ...given, ...next };
    if (embedded) return embedded.onValues(merged, step);
    setGiven(merged);
    const address = dashboardPath(id, merged);
    if (step) history.pushState(null, "", address);
    else history.replaceState(history.state, "", address);
  };

  const dashboard = file?.dashboard;
  const {
    values,
    problems: valueProblems,
    range,
  } = useMemo(
    () => (dashboard ? inputValues(dashboard, given) : { values: {}, problems: [] }),
    // The range's words count from the minute the page reads as of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dashboard, given, at],
  );
  const view = dashboard?.views.find((entry) => entry.name === given.view) ?? dashboard?.views[0];
  // What it shows, as the address has it with each value filled in, for the
  // host while the page shows, and once it has gone.
  const shownValues = useMemo(() => {
    if (!dashboard) return null;
    const shown: Record<string, string> = {};
    for (const input of dashboard.inputs) shown[input.name] = values[input.name] ?? input.default;
    if (range) Object.assign(shown, range);
    if (view && dashboard.views.length > 1) shown.view = view.name;
    return shown;
  }, [dashboard, values, range, view]);
  const shownKey = JSON.stringify(shownValues);
  useEffect(() => {
    if (!shownValues) return;
    const tell = () => {
      if (document.visibilityState === "visible") report(id, shownValues, true);
    };
    tell();
    window.addEventListener("focus", tell);
    return () => window.removeEventListener("focus", tell);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, shownKey]);
  // The values the page settles on, a second after the last change, for
  // History. The host keeps them for every window.
  const [past, setPast] = useState<DashboardHistoryEntry[]>([]);
  const readPast = useCallback(() => {
    readHistory(id).then(setPast, () => {});
  }, [id]);
  useEffect(() => {
    readPast();
    // Another window may have kept values meanwhile.
    window.addEventListener("focus", readPast);
    return () => window.removeEventListener("focus", readPast);
  }, [readPast]);
  useEffect(() => {
    if (!shownValues) return;
    const timer = setTimeout(() => {
      const by = agentShowed(id, shownValues) ? "agent" : undefined;
      keepInHistory(id, shownValues, by).then(setPast, () => {});
    }, 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, shownKey]);
  const leftWith = useRef(shownValues);
  leftWith.current = shownValues;
  useEffect(
    () => () => {
      if (leftWith.current) report(id, leftWith.current, false);
    },
    [id],
  );
  // A live dashboard reads again each minute while it ends now; a range in
  // the past does not change.
  const live = !!dashboard?.live && (!range || isRelative(range.to));
  const problems = [
    ...(file?.problems.map((problem) =>
      problem.line !== undefined ? `Line ${problem.line}: ${problem.message}` : problem.message,
    ) ?? []),
    ...valueProblems,
  ];
  const repoRoot =
    file && file.entry.where !== "Personal"
      ? file.entry.path.slice(0, file.entry.path.length - file.entry.relative.length - 1)
      : undefined;
  const folder = file?.entry.relative.split("/").slice(0, -1).join("/") ?? "";
  // A drag across a chart's time zooms the page to it; Back zooms out again.
  const zoomTo = (from: number, to: number) => change({ ...momentRange(from, to) });
  // Where the view's panels read from, named once here rather than under each.
  const sources = [
    ...new Set(
      (view?.panels ?? []).flatMap((panel) => {
        if (panel.kind !== "chart") return [];
        const name = chartSourceName(panelChartText(panel, values, live).text);
        return name ? [name] : [];
      }),
    ),
  ];

  return (
    <div {...stylex.props(styles.boardColumn, embedded && styles.boardInPane)}>
      {!embedded && (
        <button type="button" {...stylex.props(styles.back)} onClick={() => openDashboards()}>
          <Icon name="arrowLeft" size={13} />
          Dashboards
        </button>
      )}
      <div {...stylex.props(styles.heading)}>
        <h1 {...stylex.props(styles.pageTitle, embedded && styles.paneTitle)}>
          {dashboard?.title ?? file?.entry.title ?? "Dashboard"}
        </h1>
        {sources.length > 0 && (
          <span
            data-dashboard-sources=""
            {...(sources.length > 1 ? { title: sources.join("\n") } : {})}
            {...stylex.props(styles.sources)}
          >
            {sources.length === 1 ? sources[0] : `${sources.length} sources`}
            <span aria-hidden="true" {...stylex.props(styles.dot)}>
              ·
            </span>
          </span>
        )}
        <span role="status" {...stylex.props(styles.readAt)}>
          {live
            ? "Live"
            : `Read at ${new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
        </span>
        <ToolButton
          label="Read every panel again"
          icon="refresh"
          onClick={() => setAt(Date.now())}
        />
        {/* The page's tools: its values' history sits with them, so the
            inputs keep one row even in a pane. */}
        {dashboard && shownValues && (dashboard.inputs.length > 0 || range) && (
          <InputHistory
            dashboard={dashboard}
            entries={past}
            current={shownValues}
            onOpen={readPast}
            onPick={(values) => change(values)}
          />
        )}
        <ToolButton
          label={source ? "Show the dashboard" : "Show the file"}
          icon={source ? "display" : "file"}
          active={source}
          aria-pressed={source}
          onClick={() => setSource((shown) => !shown)}
        />
      </div>
      {dashboard?.description && <p {...stylex.props(styles.lead)}>{dashboard.description}</p>}
      {error && (
        <p role="alert" {...stylex.props(styles.problem)}>
          {error}
        </p>
      )}
      {problems.length > 0 && (
        <div role="alert" aria-label="Problems in the file" {...stylex.props(styles.problems)}>
          <Icon name="alert" size={14} />
          <ul {...stylex.props(styles.problemList)}>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}
      {dashboard && (dashboard.inputs.length > 0 || range) && (
        <div role="group" aria-label="Inputs" {...stylex.props(styles.inputs)}>
          {dashboard.inputs.map((input) => (
            <InputField
              key={input.name}
              input={input}
              value={values[input.name] ?? input.default}
              onChange={(value) => change({ [input.name]: value })}
            />
          ))}
          {range && <TimeRangePicker range={range} onChange={(next) => change({ ...next })} />}
        </div>
      )}
      {dashboard && dashboard.views.length > 1 && (
        <div role="tablist" aria-label="Views" {...stylex.props(styles.tabs)}>
          {dashboard.views.map((entry) => (
            <button
              key={entry.name}
              type="button"
              role="tab"
              aria-selected={entry === view}
              {...stylex.props(styles.tab, entry === view && styles.tabOn)}
              onClick={() => change({ view: entry.name }, false)}
            >
              {entry.name}
            </button>
          ))}
        </div>
      )}
      {source && file ? (
        <pre aria-label="The dashboard's file" {...stylex.props(styles.source)}>
          {file.text.split("\n").map((line, index) => (
            <span key={index} {...stylex.props(styles.sourceLine)}>
              <span {...stylex.props(styles.sourceNumber)}>{index + 1}</span>
              {line || " "}
              {"\n"}
            </span>
          ))}
        </pre>
      ) : (
        view && (
          <ChartZoom value={range ? zoomTo : null}>
            <SharedCursor>
              <Grid>
                {view.panels.map((panel, index) => (
                  <PanelCell key={`${view.name}\0${index}`} panel={panel}>
                    <Panel
                      panel={panel}
                      values={values}
                      live={live}
                      at={at}
                      files={repoRoot ? { repo: repoRoot, folder } : undefined}
                    />
                  </PanelCell>
                ))}
              </Grid>
            </SharedCursor>
          </ChartZoom>
        )
      )}
      {dashboard && view && !view.panels.length && (
        <p {...stylex.props(styles.emptyNote)}>This view has no panels yet.</p>
      )}
      {dashboard && !embedded && (
        <AskSuperagent
          context={() => ({ text: pageContext(id, dashboard, values, range, view?.name) })}
        />
      )}
    </div>
  );
}

function InputField({
  input,
  value,
  onChange,
}: {
  input: DashboardInput;
  value: string;
  onChange(value: string): void;
}) {
  const [draft, setDraft] = useState(value);
  // A value from elsewhere, as Back gives, replaces the draft.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(value);
  }
  const valid = !input.pattern || new RegExp(`^(?:${input.pattern})$`).test(draft);
  const options = input.options ?? [];
  const suggestions = useId();
  // A choice whose options could not be read is a field, so that it still
  // takes a value; the page's problems say why.
  if (input.type === "choice" && options.length) {
    const choices = options.map((option) => ({
      value: option,
      label: input.labels?.[option] ?? option,
    }));
    // The input's name inside its control, before its value, as Grafana's
    // variables have: one row of controls, no row of labels above it.
    const name = (
      <span aria-hidden="true" {...stylex.props(styles.fieldLabel)}>
        {input.label}
      </span>
    );
    return choices.length > 2 ? (
      // More than two: a menu to search.
      <SearchSelect
        trigger={[settingStyles.select, styles.control]}
        label={input.label}
        icon={name}
        value={value}
        choices={choices}
        onChange={onChange}
      />
    ) : (
      <ChoiceSelect
        trigger={[settingStyles.select, styles.control]}
        label={input.label}
        icon={name}
        value={value}
        choices={choices}
        onChange={onChange}
      />
    );
  }
  const commit = () => {
    if (draft !== value && valid) onChange(draft);
  };
  return (
    <label {...stylex.props(styles.textField, !valid && styles.textInvalid)}>
      <span {...stylex.props(styles.fieldLabel)}>{input.label}</span>
      <input
        type="text"
        value={draft}
        spellCheck={false}
        aria-invalid={!valid || undefined}
        // A text input's options are suggestions: any value it matches goes.
        list={options.length ? suggestions : undefined}
        size={Math.max(6, Math.min(28, draft.length + 1))}
        {...stylex.props(styles.text)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") setDraft(value);
        }}
      />
      {options.length > 0 && (
        <datalist id={suggestions}>
          {options.map((option) => (
            <option key={option} value={option}>
              {input.labels?.[option] ?? option}
            </option>
          ))}
        </datalist>
      )}
    </label>
  );
}

/** How wide the grid is: on a middling screen a quarter takes half; on a
 * narrow one, as a pane beside a thread is, two stats share a row and every
 * other panel is whole; on a tiny one every panel is whole. */
const GridWidth = createContext<"wide" | "medium" | "narrow" | "tiny">("wide");

/** Twelve columns, or one on a tiny screen. Each row's panels are as tall as
 * its tallest, as Grafana's and Linear's are. */
function Grid({ children }: { children: ReactNode }) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(1200);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  const size = width < 400 ? "tiny" : width < 720 ? "narrow" : width < 1080 ? "medium" : "wide";
  return (
    <GridWidth value={size}>
      <OnBoard value>
        <div
          ref={setElement}
          data-dashboard-grid={size}
          {...stylex.props(styles.grid, size === "tiny" && styles.gridTiny)}
        >
          {children}
        </div>
      </OnBoard>
    </GridWidth>
  );
}

function PanelCell({ panel, children }: { panel: DashboardPanel; children: ReactNode }) {
  const size = useContext(GridWidth);
  // On a middling grid a quarter or a third takes half, and a panel wider
  // than half takes the row, so no row ends in a gap no panel fits. On a
  // narrow one, two stats share a row.
  const stat =
    panel.kind === "chart" &&
    panel.keys.some(([key, value]) => key === "type" && value.trim() === "stat");
  const columns =
    size === "tiny"
      ? 1
      : size === "narrow"
        ? stat && panel.width <= 6
          ? 6
          : 12
        : size === "medium" && panel.width <= 4
          ? 6
          : size === "medium" && panel.width > 6
            ? 12
            : panel.width;
  return (
    <div
      data-dashboard-panel=""
      data-panel-title={panelTitle(panel)}
      data-span={columns}
      {...stylex.props(styles.cell, styles.span(columns))}
    >
      {children}
    </div>
  );
}

function Panel({
  panel,
  values,
  live,
  at,
  files,
}: {
  panel: DashboardPanel;
  values: Record<string, string>;
  live: boolean;
  at: number;
  files: { repo: string; folder: string } | undefined;
}) {
  if (panel.kind === "text")
    return (
      <div {...stylex.props(styles.textPanel)}>
        <SessionMarkdown text={substitute(panel.text, values).text} streaming={false} settled />
      </div>
    );
  const chart = panelChartText(panel, values, live);
  if (chart.unknown.length)
    return (
      <div role="alert" {...stylex.props(styles.panelNote)}>
        <span {...stylex.props(styles.panelNoteTitle)}>{panelTitle(panel)}</span>
        {chart.unknown.map((name) => `\${${name}}`).join(", ")}{" "}
        {chart.unknown.length === 1 ? "is" : "are"} no input of this dashboard.
      </div>
    );
  // A new text is new data, read afresh; the chart shows the last data,
  // dimmed, until it comes.
  const block = <ChartBlock text={chart.text} at={at} {...(files ? { files } : {})} />;
  // A drag on a chart that follows the time picker zooms the dashboard; any
  // other chart zooms on its own.
  return followsRange(panel) ? block : <ChartZoom value={null}>{block}</ChartZoom>;
}

const styles = stylex.create({
  page: {
    flex: "1",
    minHeight: 0,
    display: "flex",
    backgroundColor: tokens.canvas,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    WebkitFontSmoothing: "antialiased",
  },
  scroller: { flex: "1", minWidth: 0, overflowY: "auto" },
  listColumn: {
    boxSizing: "content-box",
    maxWidth: 720,
    marginInline: "auto",
    paddingInline: 44,
    paddingTop: 56,
    paddingBottom: "max(72px, 33vh)",
  },
  boardColumn: {
    boxSizing: "border-box",
    maxWidth: 1560,
    marginInline: "auto",
    paddingInline: { default: 36, "@media (max-width: 720px)": 16 },
    paddingTop: 28,
    paddingBottom: 96,
  },
  boardInPane: { paddingInline: 22, paddingTop: 18, paddingBottom: 48 },
  paneTitle: { fontSize: 20 },
  paneMenu: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    height: 24,
    paddingInline: 8,
    color: tokens.muted,
    fontSize: 12,
  },
  pane: {
    flex: "1",
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.canvas,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    WebkitFontSmoothing: "antialiased",
  },
  heading: { display: "flex", alignItems: "center", gap: 8, minHeight: 32 },
  pageTitle: {
    flex: "1",
    margin: 0,
    fontSize: 26,
    lineHeight: 1.2,
    fontWeight: 550,
    letterSpacing: "-0.022em",
  },
  readAt: { color: tokens.faint, fontSize: 12.5, fontVariantNumeric: "tabular-nums" },
  sources: {
    display: "inline-flex",
    gap: 8,
    minWidth: 0,
    overflow: "hidden",
    color: tokens.faint,
    fontSize: 12.5,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  dot: { color: tokens.faint },
  lead: {
    margin: 0,
    marginTop: 8,
    maxWidth: 680,
    color: tokens.muted,
    fontSize: 14,
    lineHeight: 1.55,
  },
  code: { fontFamily: tokens.code, fontSize: 12.5 },
  back: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 14,
    marginInlineStart: -8,
    paddingBlock: 4,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: tokens.buttonRound,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.muted,
    font: "inherit",
    fontSize: 12.5,
    cursor: "pointer",
  },
  problem: { color: tokens.red, fontSize: 13 },
  problems: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 18,
    paddingBlock: 12,
    paddingInline: 14,
    borderRadius: `calc(10px * ${tokens.round})`,
    backgroundColor: `color-mix(in srgb, ${tokens.warning} 10%, transparent)`,
    color: tokens.warning,
  },
  problemList: {
    margin: 0,
    paddingInlineStart: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    color: tokens.text,
    fontSize: 13,
    lineHeight: 1.45,
  },
  inputs: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginTop: 18,
  },
  // The value reads first; the name before it is quieter.
  control: { gap: 6, fontWeight: 500 },
  fieldLabel: { color: tokens.faint, fontSize: 12.5, fontWeight: 400 },
  textField: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 32,
    boxSizing: "border-box",
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: tokens.line,
      ":hover": tokens.lineStrong,
      ":focus-within": tokens.accentLine,
    },
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.canvas,
    cursor: "text",
  },
  text: {
    minWidth: 0,
    padding: 0,
    borderWidth: 0,
    outline: "none",
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.code,
    fontSize: 12.5,
  },
  textInvalid: { borderColor: tokens.red },
  tabs: {
    display: "flex",
    gap: 2,
    marginTop: 22,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  tab: {
    position: "relative",
    marginBottom: -1,
    paddingBlock: 8,
    paddingInline: 12,
    borderWidth: 0,
    borderBottomWidth: 2,
    borderBottomStyle: "solid",
    borderBottomColor: "transparent",
    backgroundColor: "transparent",
    color: { default: tokens.muted, ":hover": tokens.text },
    font: "inherit",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  },
  tabOn: { color: tokens.text, borderBottomColor: tokens.text },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
    gap: 12,
    alignItems: "stretch",
    marginTop: 18,
  },
  gridTiny: { gridTemplateColumns: "minmax(0, 1fr)" },
  cell: { minWidth: 0 },
  span: (columns: number) => ({ gridColumn: `span ${columns}` }),
  textPanel: {
    paddingBlock: 4,
    paddingInline: 4,
    color: tokens.text,
    fontSize: 14,
    lineHeight: 1.6,
  },
  panelNote: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: 20,
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: `color-mix(in srgb, ${tokens.text} 3.5%, transparent)`,
    color: tokens.muted,
  },
  panelNoteTitle: { color: tokens.text, fontSize: 13.5, fontWeight: 600 },
  source: {
    marginTop: 20,
    marginBottom: 0,
    paddingBlock: 16,
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: `color-mix(in srgb, ${tokens.text} 3.5%, transparent)`,
    fontFamily: tokens.code,
    fontSize: 12.5,
    lineHeight: 1.6,
    overflowX: "auto",
    whiteSpace: "pre",
  },
  sourceLine: { display: "block", paddingInlineEnd: 16 },
  sourceNumber: {
    display: "inline-block",
    width: 44,
    paddingInlineEnd: 16,
    color: tokens.faint,
    textAlign: "right",
    userSelect: "none",
  },
  section: { marginTop: 40 },
  sectionTitle: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    margin: 0,
    marginBottom: 14,
    fontSize: 17,
    fontWeight: 550,
    letterSpacing: "-0.012em",
  },
  count: { color: tokens.faint, fontSize: 14, fontWeight: 400 },
  card: {
    marginInline: -20,
    overflow: "hidden",
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: `color-mix(in srgb, ${tokens.text} 3.5%, transparent)`,
  },
  row: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    boxSizing: "border-box",
    minHeight: 64,
    paddingBlock: 12,
    paddingInline: 20,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.text,
    font: "inherit",
    textAlign: "start",
    cursor: "pointer",
    "::before": {
      content: '""',
      position: "absolute",
      top: 0,
      left: 20,
      right: 20,
      height: 1,
      backgroundColor: tokens.line,
    },
  },
  firstRow: { "::before": { display: "none" } },
  rowIcon: { display: "flex", color: tokens.muted },
  rowText: { display: "flex", flexDirection: "column", gap: 3, flex: "1", minWidth: 0 },
  rowTitle: { fontSize: 14, fontWeight: 500 },
  rowFacts: {
    color: tokens.muted,
    fontSize: 12.5,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  rowProblem: { color: tokens.warning },
  rowEnd: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    flexShrink: 0,
    color: tokens.muted,
    fontSize: 12.5,
    fontVariantNumeric: "tabular-nums",
  },
  rowWhen: { color: tokens.faint },
  empty: {
    marginTop: 32,
    padding: 24,
    marginInline: -20,
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: `color-mix(in srgb, ${tokens.text} 3.5%, transparent)`,
  },
  emptyTitle: { margin: 0, fontSize: 15, fontWeight: 550 },
  emptyNote: { margin: 0, marginTop: 6, color: tokens.muted, fontSize: 13.5, lineHeight: 1.55 },
});
