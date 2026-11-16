import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BarList } from "../chart/BarList";
import { LineChart, type ChartSource, type ChartState } from "../chart/Chart";
import {
  checkoutLatency,
  ingestBacklog,
  openTimes,
  requestRate,
  today,
} from "../chart/chart-fixtures";
import type { LineChartSpec, Series } from "../chart/chart-model";
import { Section, Specimen } from "./Specimen";

const GRAFANA = "https://grafana.internal.example";
// The page's sample times, from when it loads.
const at = {
  nine: today(9),
  deploy: today(10, 42),
  rollback: today(11, 5),
  noon: today(12),
  one: today(13),
  three: today(15),
  now: Date.now(),
};

/**
 * A chart whose data comes from Grafana, as Med would fetch it: nothing
 * until it nears the view, then a waiting line, then the data. Fetch again
 * shows the wait once more.
 */
function Fetched({
  spec,
  load,
  source,
  delay = 1400,
  fail,
}: {
  spec: LineChartSpec;
  load: () => Series[];
  source: ChartSource;
  delay?: number;
  fail?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ChartState>("loading");
  const [series, setSeries] = useState<Series[]>(() =>
    load().map(({ name }) => ({ name, points: [] })),
  );
  const [fetched, setFetched] = useState<number>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fetchNow = useCallback(() => {
    setState("loading");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (fail) return setState("error");
      setSeries(load());
      setFetched(Date.now());
      setState("ready");
    }, delay);
  }, [load, delay, fail]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        fetchNow();
      },
      { rootMargin: "120px" },
    );
    observer.observe(host.current!);
    return () => {
      observer.disconnect();
      clearTimeout(timer.current);
    };
  }, [fetchNow]);
  return (
    <div ref={host}>
      <LineChart
        spec={spec}
        series={series}
        state={state}
        error={fail}
        source={{ ...source, fetched }}
        onRefresh={fetchNow}
      />
    </div>
  );
}

/** The reply's width, where a chart sits in a thread. */
function Column({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.column)}>{children}</div>;
}

const latency = { load: checkoutLatency };

export function ChartsSection() {
  return (
    <Section
      id="charts"
      title="Charts"
      lede="A chart block in a reply, drawn by Med on the theme's colors. Its data comes from a Grafana link (fetched when the chart nears the view), a file a script wrote, or rows the agent writes. Hover for values, drag to zoom, switch to a log axis, copy it as a picture."
    >
      <Specimen
        title="From a Grafana panel"
        note="The panel's time range is pinned, so the chart shows what the agent looked at. Fetch again redraws it."
        padded
      >
        <Column>
          <Fetched
            spec={{
              title: "p99 went past 2 s after the 10:42 deploy, and recovered after the rollback",
              subtitle: "Checkout API latency, ms",
              unit: "ms",
              ramp: true,
              threshold: { value: 500, label: "SLO 500 ms" },
              marks: [
                { at: at.deploy, label: "Deploy v412" },
                { at: at.rollback, label: "Rollback" },
              ],
            }}
            load={latency.load}
            source={{
              kind: "grafana",
              label: "Checkout › Latency",
              url: `${GRAFANA}/d/checkout/checkout?viewPanel=12&from=${at.nine}&to=${at.noon}`,
              range: [at.nine, at.noon],
            }}
          />
        </Column>
      </Specimen>
      <Specimen
        title="One series"
        note="One line takes a soft fill and leads with its value, and the change across the range. The newest point breathes while the range ends now."
        span="half"
      >
        <Fetched
          spec={{
            title: "Traffic peaks mid-afternoon",
            subtitle: "Requests per second",
            unit: "req/s",
          }}
          load={requestRate}
          source={{
            kind: "grafana",
            label: "Checkout › Traffic",
            url: `${GRAFANA}/d/checkout/checkout?viewPanel=3&from=now-24h&to=now`,
            range: [at.now - 24 * 3_600_000, at.now],
            live: true,
          }}
          delay={900}
        />
      </Specimen>
      <Specimen
        title="A log axis"
        note="The agent can open a chart on a log axis; steady growth is then a straight line."
        span="half"
      >
        <Fetched
          spec={{
            title: "The backlog grew ten thousand times in 45 minutes",
            subtitle: "Ingest queue depth, messages",
            scale: "log",
          }}
          load={ingestBacklog}
          source={{
            kind: "grafana",
            label: "Ingest › Queue depth",
            url: `${GRAFANA}/d/ingest/ingest?viewPanel=7`,
            range: [at.one, at.three],
          }}
          delay={1100}
        />
      </Specimen>
      <Specimen
        title="Values to compare"
        note="A bar a row, the label inside it. Hover a row for its difference from the one the chart is about."
        span="half"
      >
        <BarList
          title="Threads open a quarter faster in this build"
          subtitle="Time to open a 400-message thread, median of 20 runs"
          unit="ms"
          bars={openTimes}
          source="From bench/open-thread.csv"
        />
      </Specimen>
      <Specimen
        title="When Grafana can't answer"
        note="The reason, in Grafana's words."
        span="half"
      >
        <Fetched
          spec={{ title: "Payment errors by provider", subtitle: "Errors per minute" }}
          load={() => [
            { name: "stripe", points: [] },
            { name: "adyen", points: [] },
          ]}
          source={{
            kind: "grafana",
            label: "Payments › Errors",
            url: `${GRAFANA}/d/payments/payments?viewPanel=2`,
            range: [at.nine, at.noon],
          }}
          fail="Grafana answered 403: this token can't read the Payments folder."
          delay={1200}
        />
      </Specimen>
    </Section>
  );
}

const styles = stylex.create({
  column: { maxWidth: 720, marginInline: "auto" },
});
