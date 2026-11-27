import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  frecencyRank,
  paletteTupleKey,
  substituteTemplate,
  type PaletteAction,
  type PaletteFrecencyEntry,
  type PaletteItem,
  type PaletteSpec,
} from "../../shared/palettes";
import {
  formatCacheAge,
  keptPaletteItems,
  matchPaletteText,
  openExternalUrl,
  openMedAddress,
  readPaletteItems,
  recordPaletteVisit,
  resolveActionPreview,
  stepItemFrecency,
  type PaletteItemsResponse,
  type TextRanges,
} from "../data/palettes";
import { picked, tokens, ui } from "../theme.stylex";
import { Icon, type IconName } from "./Icon";
import { Matched, PaletteActions, PaletteKeys, usePaletteFade } from "./Palette";

export interface ActivePaletteScope {
  kind: "palette" | "dashboard";
  id: string;
  title: string;
  spec?: PaletteSpec;
  loading?: boolean;
  error?: string;
}

interface LockedStep {
  step: string;
  value: string;
  label: string;
}

type ScopeRow =
  | {
      kind: "frequent";
      id: string;
      label: string;
      subtitle?: string;
      entry: PaletteFrecencyEntry;
      ranges?: TextRanges;
    }
  | {
      kind: "item";
      id: string;
      item: PaletteItem;
      ranges?: TextRanges;
      custom?: boolean;
    }
  | {
      kind: "action";
      id: string;
      action: PaletteAction;
      preview: string;
      ranges?: TextRanges;
    };

function actionIcon(action: PaletteAction): IconName {
  if (action.openMed) return "display";
  if (action.openUrl) return "external";
  return "copy";
}

function defaultActionOf(spec: PaletteSpec | undefined): PaletteAction | undefined {
  if (!spec?.actions.length) return undefined;
  return spec.actions.find((action) => action.default) ?? spec.actions[0];
}

function shortActionVerb(action: PaletteAction | undefined): string {
  if (!action) return "Run";
  if (action.openMed) return "Open";
  if (action.openUrl) return "Open";
  if (action.copy) return "Copy";
  return "Run";
}

function tupleLabel(spec: PaletteSpec, entry: PaletteFrecencyEntry): string {
  const parts: string[] = [];
  for (const step of spec.steps) {
    const label = entry.labels[step.name] ?? entry.values[step.name];
    if (label) parts.push(label);
  }
  if (parts.length > 0) return parts.join(" › ");
  return Object.values(entry.labels).filter(Boolean).join(" › ") || entry.tupleKey;
}

function tupleMatchesLaterStep(
  spec: PaletteSpec,
  entry: PaletteFrecencyEntry,
  query: string,
): boolean {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return false;
  const words = wanted.split(/\s+/);
  for (let index = 1; index < spec.steps.length; index++) {
    const step = spec.steps[index]!;
    const label = (entry.labels[step.name] ?? "").toLowerCase();
    const value = (entry.values[step.name] ?? "").toLowerCase();
    if (words.some((word) => word && (label.includes(word) || value.includes(word)))) {
      return true;
    }
  }
  return false;
}

const DELAY_LOADING_MS = 250;
const STALE_RECHECK_DELAYS_MS = [450, 900, 1800, 3000, 5000] as const;

export function PaletteScopeView({
  scope,
  frecency,
  onExit,
  onClose,
  onFrecencyChange,
}: {
  scope: ActivePaletteScope;
  frecency: readonly PaletteFrecencyEntry[];
  onExit(): void;
  onClose(navigated: boolean): void;
  onFrecencyChange?(entries: PaletteFrecencyEntry[]): void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultList = useRef<HTMLDivElement>(null);
  const fade = usePaletteFade<HTMLDivElement>();
  const listRef = useCallback(
    (node: HTMLDivElement | null) => {
      resultList.current = node;
      return fade(node);
    },
    [fade],
  );

  const [locked, setLocked] = useState<LockedStep[]>([]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<"steps" | "actions">("steps");
  const [actionTuple, setActionTuple] = useState<{
    values: Record<string, string>;
    labels: Record<string, string>;
  } | null>(null);
  const [confirmActionId, setConfirmActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedNotice, setCopiedNotice] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const pendingForceRefreshRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const [stepResponse, setStepResponse] = useState<{
    key: string;
    data?: PaletteItemsResponse;
    error?: string;
  }>({ key: "" });
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scopeId = scope.id;

  // Reset state whenever the user scopes into a different palette.
  const [prevScopeId, setPrevScopeId] = useState(scopeId);
  if (prevScopeId !== scopeId) {
    setPrevScopeId(scopeId);
    setLocked([]);
    setQuery("");
    setActive(0);
    setMode("steps");
    setActionTuple(null);
    setConfirmActionId(null);
    setActionError(null);
    setCopiedNotice(null);
    setRefreshNonce(0);
  }

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, [scopeId]);

  const spec = scope.spec;
  const stepIndex = locked.length;
  const currentStep = spec?.steps[stepIndex];
  const isLastStep = Boolean(spec && stepIndex >= spec.steps.length - 1);
  const effectiveMode = spec && spec.steps.length === 0 ? "actions" : mode;

  const lockedValues = useMemo(() => {
    const out: Record<string, string> = {};
    for (const item of locked) out[item.step] = item.value;
    return out;
  }, [locked]);

  const lockedLabels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const item of locked) out[item.step] = item.label;
    return out;
  }, [locked]);

  const depValues = useMemo(() => {
    if (!currentStep) return {};
    const out: Record<string, string> = {};
    for (const dep of currentStep.dependsOn) {
      if (lockedValues[dep] !== undefined) out[dep] = lockedValues[dep]!;
    }
    return out;
  }, [currentStep, lockedValues]);

  const isRemoteStep = Boolean(
    currentStep && (currentStep.source.command || currentStep.source.file),
  );
  const stepKey = currentStep
    ? `${scope.id}\0${currentStep.name}\0${paletteTupleKey(depValues)}`
    : "";

  // Synchronous read from client cache so reopening paints on frame 0.
  const cachedResponse =
    currentStep && isRemoteStep
      ? keptPaletteItems(scope.id, currentStep.name, depValues)
      : undefined;
  const activeResponse =
    stepResponse.key === stepKey && stepResponse.data ? stepResponse.data : cachedResponse;
  const stepError = stepResponse.key === stepKey ? stepResponse.error : undefined;

  // Fetch remote step items (SWR: show cached immediately, refresh quietly if stale).
  useEffect(() => {
    if (!currentStep || !isRemoteStep || effectiveMode !== "steps") {
      setRefreshing(false);
      setShowLoading(false);
      return;
    }
    const abort = new AbortController();
    const force = pendingForceRefreshRef.current;
    pendingForceRefreshRef.current = false;
    const hadCached = Boolean(keptPaletteItems(scope.id, currentStep.name, depValues));
    setRefreshing(force);
    setShowLoading(false);

    let loadingTimer: ReturnType<typeof setTimeout> | null = hadCached
      ? null
      : setTimeout(() => {
          if (!abort.signal.aborted) setShowLoading(true);
        }, DELAY_LOADING_MS);

    const clearLoadingTimer = () => {
      if (loadingTimer) {
        clearTimeout(loadingTimer);
        loadingTimer = null;
      }
    };

    let recheckTimer: ReturnType<typeof setTimeout> | null = null;

    const load = async (refresh: boolean, attempt = 0) => {
      try {
        const result = await readPaletteItems(
          {
            paletteId: scope.id,
            step: currentStep.name,
            values: depValues,
            refresh: refresh || undefined,
          },
          abort.signal,
        );
        if (abort.signal.aborted) return;
        clearLoadingTimer();
        setStepResponse({ key: stepKey, data: result, error: result.error });
        setRefreshing(false);
        setShowLoading(false);
        // Host served stale disk cache while refreshing in background: poll gently until fresh.
        if (result.stale && result.fromCache && attempt < STALE_RECHECK_DELAYS_MS.length) {
          const delay = STALE_RECHECK_DELAYS_MS[attempt]!;
          recheckTimer = setTimeout(() => {
            if (!abort.signal.aborted) void load(false, attempt + 1);
          }, delay);
        }
      } catch (reason) {
        if (abort.signal.aborted) return;
        clearLoadingTimer();
        setStepResponse({
          key: stepKey,
          data: keptPaletteItems(scope.id, currentStep.name, depValues),
          error: reason instanceof Error ? reason.message : String(reason),
        });
        setRefreshing(false);
        setShowLoading(false);
      }
    };

    void load(force);

    return () => {
      abort.abort();
      clearLoadingTimer();
      if (recheckTimer) clearTimeout(recheckTimer);
    };
  }, [currentStep, depValues, effectiveMode, isRemoteStep, refreshNonce, scope.id, stepKey]);

  const rawItems: PaletteItem[] = useMemo(() => {
    if (!currentStep) return [];
    if (currentStep.source.options) return currentStep.source.options;
    return activeResponse?.items ?? [];
  }, [activeResponse?.items, currentStep]);

  const [now] = useState(() => Date.now());
  const defaultAction = defaultActionOf(spec);

  const sections = useMemo(() => {
    if (!spec) return [];
    const trimmed = query.trim();

    if (effectiveMode === "actions") {
      const values = actionTuple?.values ?? lockedValues;
      const rows: ScopeRow[] = spec.actions.flatMap((action): ScopeRow[] => {
        const preview = resolveActionPreview(action, values);
        if (!trimmed) {
          return [{ kind: "action", id: `action:${action.id}`, action, preview }];
        }
        const matched = matchPaletteText(action.label, preview, trimmed);
        if (!matched) return [];
        return [
          { kind: "action", id: `action:${action.id}`, action, preview, ranges: matched.ranges },
        ];
      });
      return rows.length ? [{ title: "Actions", rows }] : [];
    }

    if (!currentStep) return [];

    // 1. Step items ranked by fuzzy match + zoxide per-step frecency.
    const itemBoost = stepItemFrecency(frecency, scope.id, currentStep.name, lockedValues, now);
    const matchedItems = rawItems
      .flatMap((item, index) => {
        const keywords = [item.value, item.subtitle, item.keywords].filter(Boolean).join(" ");
        const match = trimmed
          ? matchPaletteText(item.label, keywords, trimmed)
          : { score: 0, ranges: [] as TextRanges };
        if (!match) return [];
        const boost = Math.min(180, Math.log1p(itemBoost.get(item.value) ?? 0) * 45);
        return [
          {
            item,
            index,
            textScore: match.score,
            totalScore: match.score + boost,
            ranges: match.ranges,
          },
        ];
      })
      .sort((a, b) => b.totalScore - a.totalScore || a.index - b.index);

    const stepRows: ScopeRow[] = matchedItems.map(({ item, ranges }) => ({
      kind: "item",
      id: `item:${currentStep.name}:${item.value}`,
      item,
      ranges: ranges.length ? ranges : undefined,
    }));

    if (
      currentStep.allowCustom &&
      trimmed &&
      !rawItems.some(
        (item) =>
          item.value.toLowerCase() === trimmed.toLowerCase() ||
          item.label.toLowerCase() === trimmed.toLowerCase(),
      )
    ) {
      stepRows.push({
        kind: "item",
        id: `custom:${currentStep.name}:${trimmed}`,
        item: { value: trimmed, label: trimmed, subtitle: "Custom value" },
        custom: true,
      });
    }

    // 2. Frequent tuples (only at Step 0 for multi-step palettes whose current steps all exist).
    const frequentMatches =
      stepIndex === 0 && spec.steps.length > 1
        ? frecency
            .filter(
              (entry) =>
                entry.paletteId === scope.id &&
                spec.steps.every((step) => entry.values[step.name] !== undefined),
            )
            .map((entry) => ({
              entry,
              rank: frecencyRank(entry, now),
              label: tupleLabel(spec, entry),
            }))
            .sort((a, b) => b.rank - a.rank)
            .flatMap(({ entry, rank, label }) => {
              const keywords = [
                ...Object.values(entry.values),
                ...Object.values(entry.labels),
              ].join(" ");
              const match = trimmed
                ? matchPaletteText(label, keywords, trimmed)
                : { score: 0, ranges: [] as TextRanges };
              if (!match) return [];
              return [
                {
                  entry,
                  label,
                  rank,
                  textScore: match.score,
                  matchesLater: tupleMatchesLaterStep(spec, entry, trimmed),
                  ranges: match.ranges,
                },
              ];
            })
            .slice(0, trimmed ? 6 : 4)
        : [];

    const frequentRows: ScopeRow[] = frequentMatches.map(({ entry, label, ranges }) => ({
      kind: "frequent",
      id: `freq:${entry.tupleKey}`,
      label,
      subtitle: defaultAction?.label,
      entry,
      ranges: ranges.length ? ranges : undefined,
    }));

    if (frequentRows.length === 0) {
      return stepRows.length ? [{ title: currentStep.placeholder, rows: stepRows }] : [];
    }
    if (stepRows.length === 0) {
      return [{ title: "Frequent", rows: frequentRows }];
    }

    // When typing a single-word prefix of Step 1 (e.g. "st" -> Staging), keep Step 1
    // first so Tab always locks the scope chip cleanly; when typing a later-step term
    // (e.g. "checkout" or "prod ch") or with empty query, keep Frequent first for 0-Tab jump.
    const topStepPrefix = (matchedItems[0]?.textScore ?? 0) >= 900;
    const anyLaterMatch = frequentMatches.some((match) => match.matchesLater);
    if (trimmed && topStepPrefix && !anyLaterMatch) {
      return [
        { title: currentStep.placeholder, rows: stepRows },
        { title: "Frequent", rows: frequentRows },
      ];
    }
    return [
      { title: "Frequent", rows: frequentRows },
      { title: currentStep.placeholder, rows: stepRows },
    ];
  }, [
    actionTuple?.values,
    currentStep,
    defaultAction?.label,
    effectiveMode,
    frecency,
    lockedValues,
    now,
    query,
    rawItems,
    scope.id,
    spec,
    stepIndex,
  ]);

  const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections]);
  const safeActive = rows.length ? Math.min(active, rows.length - 1) : 0;

  useEffect(() => {
    resultList.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [safeActive, sections.length]);

  const executeAction = useCallback(
    (action: PaletteAction, values: Record<string, string>, labels: Record<string, string>) => {
      if (action.confirm && confirmActionId !== action.id) {
        setConfirmActionId(action.id);
        return;
      }
      setConfirmActionId(null);
      setActionError(null);

      const recordVisit = () => {
        if (Object.keys(values).length > 0) {
          void recordPaletteVisit({ paletteId: scope.id, values, labels })
            .then((entries) => onFrecencyChange?.(entries))
            .catch(() => {});
        }
      };

      if (action.openMed) {
        const target = substituteTemplate(action.openMed, values, true);
        if (!openMedAddress(target)) {
          setActionError(`Invalid Med address: ${target}`);
          return;
        }
        recordVisit();
        onClose(true);
        return;
      }

      if (action.openUrl) {
        const target = substituteTemplate(action.openUrl, values, true);
        if (!openExternalUrl(target)) {
          setActionError(`Invalid URL: ${target}`);
          return;
        }
        recordVisit();
        onClose(false);
        return;
      }

      if (action.copy !== undefined) {
        const text = substituteTemplate(action.copy, values, Boolean(action.copyEncoded));
        recordVisit();
        void navigator.clipboard?.writeText(text).catch(() => {});
        setCopiedNotice(`Copied: ${text}`);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => {
          setCopiedNotice(null);
          onClose(false);
        }, 480);
      }
    },
    [confirmActionId, onClose, onFrecencyChange, scope.id],
  );

  const openActionsFor = useCallback(
    (values: Record<string, string>, labels: Record<string, string>) => {
      setActionTuple({ values, labels });
      setMode("actions");
      setQuery("");
      setActive(0);
      setConfirmActionId(null);
      inputRef.current?.focus();
    },
    [],
  );

  const lockItem = useCallback(
    (item: PaletteItem) => {
      if (!currentStep) return;
      setLocked((prev) => [
        ...prev,
        { step: currentStep.name, value: item.value, label: item.label },
      ]);
      setQuery("");
      setActive(0);
      setRefreshNonce(0);
      inputRef.current?.focus();
    },
    [currentStep],
  );

  const activateRow = useCallback(
    (row: ScopeRow, openActionsMenu: boolean) => {
      if (row.kind === "action") {
        const values = actionTuple?.values ?? lockedValues;
        const labels = actionTuple?.labels ?? lockedLabels;
        executeAction(row.action, values, labels);
        return;
      }
      if (row.kind === "frequent") {
        if (openActionsMenu) {
          openActionsFor(row.entry.values, row.entry.labels);
        } else if (defaultAction) {
          executeAction(defaultAction, row.entry.values, row.entry.labels);
        }
        return;
      }
      // Step item
      if (!currentStep) return;
      if (!isLastStep) {
        lockItem(row.item);
        return;
      }
      const nextValues = { ...lockedValues, [currentStep.name]: row.item.value };
      const nextLabels = { ...lockedLabels, [currentStep.name]: row.item.label };
      if (openActionsMenu) {
        openActionsFor(nextValues, nextLabels);
      } else if (defaultAction) {
        executeAction(defaultAction, nextValues, nextLabels);
      }
    },
    [
      actionTuple?.labels,
      actionTuple?.values,
      currentStep,
      defaultAction,
      executeAction,
      isLastStep,
      lockItem,
      lockedLabels,
      lockedValues,
      openActionsFor,
    ],
  );

  const popChipFrom = (index: number) => {
    setMode("steps");
    setActionTuple(null);
    setConfirmActionId(null);
    setLocked((prev) => prev.slice(0, index));
    setQuery("");
    setActive(0);
    setRefreshNonce(0);
    inputRef.current?.focus();
  };

  // Chips displayed inside the search bar: root palette chip + locked step chips.
  const displayChips: { key: string; label: string; onRemove?: () => void }[] =
    effectiveMode === "actions" && actionTuple && spec
      ? spec.steps
          .filter((step) => actionTuple.values[step.name] !== undefined)
          .map((step) => ({
            key: step.name,
            label: actionTuple.labels[step.name] ?? actionTuple.values[step.name]!,
          }))
      : locked.map((entry, index) => ({
          key: `${entry.step}:${index}`,
          label: entry.label,
          onRemove: () => popChipFrom(index),
        }));

  const placeholder =
    effectiveMode === "actions"
      ? "Choose action…"
      : currentStep
        ? `Search ${currentStep.placeholder.toLowerCase()}…`
        : "Loading…";

  const triggerRefresh = () => {
    if (!isRemoteStep || effectiveMode !== "steps") return;
    pendingForceRefreshRef.current = true;
    setRefreshNonce((n) => n + 1);
    inputRef.current?.focus();
  };

  let position = 0;

  return (
    <>
      <div {...stylex.props(ui.paletteInput, styles.inputBar)}>
        <span {...stylex.props(styles.leadIcon)}>
          <Icon name={scope.kind === "dashboard" ? "display" : "jump"} />
        </span>
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Exit ${scope.title} palette`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onExit}
          {...stylex.props(styles.rootToken)}
        >
          <span {...stylex.props(styles.tokenName)}>{scope.title}</span>
          <span aria-hidden="true" {...stylex.props(styles.tokenClose)}>
            <Icon name="close" size={12} />
          </span>
        </button>
        {displayChips.map((chip) =>
          chip.onRemove ? (
            <button
              key={chip.key}
              type="button"
              tabIndex={-1}
              aria-label={`Remove ${chip.label}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={chip.onRemove}
              {...stylex.props(styles.stepToken)}
            >
              <span {...stylex.props(styles.tokenName)}>{chip.label}</span>
              <span aria-hidden="true" {...stylex.props(styles.tokenClose)}>
                <Icon name="close" size={12} />
              </span>
            </button>
          ) : (
            <span key={chip.key} {...stylex.props(styles.stepToken, styles.stepTokenStatic)}>
              <span {...stylex.props(styles.tokenName)}>{chip.label}</span>
            </span>
          ),
        )}
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setConfirmActionId(null);
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r") {
              event.preventDefault();
              triggerRefresh();
              return;
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setConfirmActionId(null);
              setActive((index) => Math.min(index + 1, Math.max(0, rows.length - 1)));
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setConfirmActionId(null);
              setActive((index) => Math.max(0, index - 1));
              return;
            }
            if (event.key === "Backspace" && query.length === 0) {
              event.preventDefault();
              if (mode === "actions") {
                setMode("steps");
                setActionTuple(null);
                setConfirmActionId(null);
                setActive(0);
              } else if (locked.length > 0) {
                popChipFrom(locked.length - 1);
              } else {
                onExit();
              }
              return;
            }
            if (event.key === "Tab") {
              event.preventDefault();
              const selected = rows[safeActive];
              if (!selected) return;
              if (selected.kind === "item" && !isLastStep) {
                lockItem(selected.item);
              } else if (selected.kind === "item" && isLastStep) {
                activateRow(selected, true);
              } else if (selected.kind === "frequent") {
                activateRow(selected, true);
              }
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              const selected = rows[safeActive];
              if (!selected) return;
              activateRow(selected, event.metaKey || event.ctrlKey);
            }
          }}
          {...stylex.props(ui.paletteField, styles.field)}
          placeholder={placeholder}
          aria-label={placeholder}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-scope-results"
          aria-activedescendant={rows[safeActive] ? `scope-opt-${safeActive}` : undefined}
        />
      </div>

      <div
        id="palette-scope-results"
        ref={listRef}
        role="listbox"
        aria-label={scope.title}
        hidden={!rows.length}
        {...stylex.props(ui.paletteList)}
      >
        {sections.map((section, sectionIndex) => {
          const sectionRows = section.rows.map((row) => {
            const index = position++;
            const selected = index === safeActive;
            const optionId = `scope-opt-${index}`;
            const rowKey = `${sectionIndex}:${index}:${row.id}`;

            if (row.kind === "frequent") {
              return (
                <button
                  type="button"
                  tabIndex={-1}
                  id={optionId}
                  key={rowKey}
                  role="option"
                  aria-selected={selected}
                  onMouseMove={() => setActive(index)}
                  onClick={(event) => activateRow(row, event.metaKey || event.ctrlKey)}
                  {...stylex.props(ui.paletteRow, selected && [ui.paletteRowOn, picked])}
                >
                  <span {...stylex.props(ui.paletteRowIcon)}>
                    <Icon name="clock" />
                  </span>
                  <span {...stylex.props(ui.paletteRowText)}>
                    <Matched text={row.label} ranges={row.ranges} />
                  </span>
                  {selected ? (
                    <PaletteActions
                      actions={[
                        { label: shortActionVerb(defaultAction), keys: "↵" },
                        ...(spec && spec.actions.length > 1
                          ? [{ label: "Actions", keys: "⌘↵" }]
                          : []),
                      ]}
                    />
                  ) : (
                    row.subtitle && <span {...stylex.props(ui.paletteAside)}>{row.subtitle}</span>
                  )}
                </button>
              );
            }

            if (row.kind === "action") {
              const confirming = confirmActionId === row.action.id;
              return (
                <button
                  type="button"
                  tabIndex={-1}
                  id={optionId}
                  key={rowKey}
                  role="option"
                  aria-selected={selected}
                  onMouseMove={() => setActive(index)}
                  onClick={() => activateRow(row, false)}
                  {...stylex.props(ui.paletteRow, selected && [ui.paletteRowOn, picked])}
                >
                  <span {...stylex.props(ui.paletteRowIcon)}>
                    <Icon name={actionIcon(row.action)} />
                  </span>
                  <span {...stylex.props(ui.paletteRowText)}>
                    <Matched text={row.action.label} ranges={row.ranges} />
                  </span>
                  {confirming ? (
                    <span {...stylex.props(styles.confirmHint)}>Press ↵ again to confirm</span>
                  ) : (
                    <>
                      {row.preview && (
                        <span
                          {...stylex.props(
                            ui.paletteAside,
                            ui.paletteAsideMono,
                            styles.actionPreview,
                          )}
                        >
                          {row.preview}
                        </span>
                      )}
                      {selected && <PaletteKeys value="↵" />}
                    </>
                  )}
                </button>
              );
            }

            // Step item row
            return (
              <button
                type="button"
                tabIndex={-1}
                id={optionId}
                key={rowKey}
                role="option"
                aria-selected={selected}
                onMouseMove={() => setActive(index)}
                onClick={(event) => activateRow(row, event.metaKey || event.ctrlKey)}
                {...stylex.props(ui.paletteRow, selected && [ui.paletteRowOn, picked])}
              >
                <span {...stylex.props(ui.paletteRowIcon)}>
                  <Icon
                    name={
                      row.custom
                        ? "plus"
                        : scope.kind === "dashboard"
                          ? "display"
                          : isLastStep
                            ? "terminal"
                            : "arrowRight"
                    }
                  />
                </span>
                <span {...stylex.props(ui.paletteRowText)}>
                  {row.custom ? (
                    <>Use “{row.item.label}”</>
                  ) : (
                    <Matched text={row.item.label} ranges={row.ranges} />
                  )}
                </span>
                {selected ? (
                  isLastStep ? (
                    <PaletteActions
                      actions={[
                        { label: shortActionVerb(defaultAction), keys: "↵" },
                        ...(spec && spec.actions.length > 1
                          ? [{ label: "Actions", keys: "⌘↵" }]
                          : []),
                      ]}
                    />
                  ) : (
                    <PaletteActions actions={[{ label: "Scope", keys: "Tab" }]} />
                  )
                ) : (
                  row.item.subtitle && (
                    <span {...stylex.props(ui.paletteAside)}>{row.item.subtitle}</span>
                  )
                )}
              </button>
            );
          });

          const labelId = `scope-section-${sectionIndex}`;
          return (
            <div
              key={`${sectionIndex}:${section.title}`}
              role="group"
              aria-labelledby={labelId}
              {...stylex.props(ui.paletteGroup)}
            >
              <div id={labelId} {...stylex.props(ui.label, ui.paletteSection)}>
                {section.title}
              </div>
              {sectionRows}
            </div>
          );
        })}
      </div>

      {/* Always mounted so screen readers hear status changes. */}
      <p role="status" {...stylex.props(rows.length ? ui.srOnly : ui.paletteEmpty)}>
        {rows.length
          ? ""
          : scope.error
            ? scope.error
            : stepError
              ? stepError
              : scope.loading || showLoading
                ? `Loading ${currentStep?.placeholder.toLowerCase() ?? scope.title.toLowerCase()}…`
                : query.trim()
                  ? `No matches for “${query.trim()}”`
                  : `No ${currentStep?.placeholder.toLowerCase() ?? "items"}`}
      </p>

      <div {...stylex.props(styles.footer)}>
        <div {...stylex.props(styles.footerLeft)}>
          <span
            role="status"
            {...stylex.props(copiedNotice || actionError ? styles.statusVisible : ui.srOnly)}
          >
            {copiedNotice ? (
              <span {...stylex.props(styles.copied)}>
                <Icon name="check" size={12} />
                <span {...stylex.props(styles.copiedText)}>{copiedNotice}</span>
              </span>
            ) : actionError ? (
              <span {...stylex.props(styles.footerWarn)}>{actionError}</span>
            ) : (
              ""
            )}
          </span>
          {copiedNotice || actionError ? null : stepError && rows.length > 0 ? (
            <span {...stylex.props(styles.footerWarn)}>{stepError}</span>
          ) : effectiveMode === "steps" && isRemoteStep ? (
            <>
              <span>
                {refreshing
                  ? "Refreshing…"
                  : activeResponse?.cachedAt
                    ? `Cached ${formatCacheAge(activeResponse.cachedAt)}${activeResponse.stale ? " · updating" : ""}`
                    : "Ready"}
              </span>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={triggerRefresh}
                {...stylex.props(styles.refreshBtn)}
              >
                <Icon name="refresh" size={11} />
                <span>Refresh ⌘R</span>
              </button>
            </>
          ) : (
            <span>{scope.kind === "dashboard" ? "Dashboard inputs" : scope.title}</span>
          )}
        </div>
        <span aria-hidden="true" {...stylex.props(styles.footerKeys)}>
          {effectiveMode === "actions"
            ? "↵ run · ⌫ back"
            : isLastStep
              ? "↵ open · ⌘↵ actions · ⌫ back"
              : "Tab scope · ⌫ back"}
        </span>
      </div>
    </>
  );
}

const paletteRule = `color-mix(in srgb, var(--med-line-from, ${tokens.text}) 7.5%, transparent)`;

const styles = stylex.create({
  inputBar: {
    flexWrap: "wrap",
    rowGap: 6,
  },
  leadIcon: {
    display: "inline-flex",
    alignItems: "center",
    color: tokens.muted,
    flexShrink: 0,
  },
  field: {
    minWidth: 120,
  },
  rootToken: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    flexShrink: 0,
    maxWidth: "38%",
    height: 25,
    paddingInlineStart: 8,
    paddingInlineEnd: 4,
    borderWidth: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: { default: tokens.accentSoft, ":hover": tokens.accentSoft },
    color: tokens.accent,
    fontFamily: tokens.ui,
    fontSize: 12.5,
    fontWeight: 550,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  stepToken: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    flexShrink: 0,
    maxWidth: "34%",
    height: 25,
    paddingInlineStart: 8,
    paddingInlineEnd: 4,
    borderWidth: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: { default: tokens.fillStrong, ":hover": tokens.fillStrong },
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12.5,
    fontWeight: 500,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  stepTokenStatic: {
    paddingInlineEnd: 8,
    cursor: "default",
  },
  tokenName: {
    minWidth: 0,
    maxWidth: 200,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  tokenClose: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 17,
    height: 17,
    borderRadius: `calc(4px * ${tokens.round})`,
    opacity: { default: 0.55, ":hover": 1 },
  },
  actionPreview: {
    maxWidth: "46%",
  },
  confirmHint: {
    marginInlineStart: "auto",
    color: tokens.accent,
    fontSize: 12,
    fontWeight: 550,
    whiteSpace: "nowrap",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexShrink: 0,
    minHeight: 33,
    paddingBlock: 6,
    paddingInline: 16,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: paletteRule,
    color: tokens.faint,
    fontSize: 11.5,
  },
  footerLeft: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
    overflow: "hidden",
  },
  footerWarn: {
    color: tokens.muted,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  refreshBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    paddingBlock: 2,
    paddingInline: 6,
    borderWidth: 0,
    borderRadius: `calc(5px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.muted, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 11.5,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  statusVisible: {
    display: "inline-flex",
    alignItems: "center",
    minWidth: 0,
  },
  copied: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    color: tokens.accent,
    fontWeight: 500,
    minWidth: 0,
  },
  copiedText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  footerKeys: {
    flexShrink: 0,
    whiteSpace: "nowrap",
    color: tokens.faint,
  },
});
