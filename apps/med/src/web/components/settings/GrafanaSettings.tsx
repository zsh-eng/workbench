import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import { keychainCommand, type GrafanaSite } from "../../../shared/charts";
import { connectGrafana, grafanaSites, removeGrafana } from "../../data/charts";
import { useSettingsFile } from "../../data/settings-file";
import { tokens } from "../../theme.stylex";
import { Row, Section, settingStyles } from "./SettingsParts";

// The Grafanas that charts in replies read panels from. Each address is a
// setting (`grafana.sites`). Its token stays in a Keychain item that the
// settings name (`grafana.keychain`), or goes to Med's server, which keeps it
// in a file of its own that no page reads back. `med grafana` does the same.

const message = (reason: unknown) =>
  reason instanceof Error ? reason.message : "Med could not reach Grafana.";

/** An address as its host and any path, for a row's label. */
const shortAddress = (address: string) => address.replace(/^https?:\/\//, "");

export function GrafanaSettings() {
  const file = useSettingsFile();
  const listed = JSON.stringify(file?.settings["grafana.sites"] ?? []);
  const [sites, setSites] = useState<GrafanaSite[] | null>(null);
  const [checks, setChecks] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  // Read again when the setting changes, also when an agent edits the file.
  useEffect(() => {
    const abort = new AbortController();
    grafanaSites(abort.signal).then(
      (answer) => setSites(answer.sites),
      (reason: unknown) => {
        if (!abort.signal.aborted) setFailure(message(reason));
      },
    );
    return () => abort.abort();
  }, [listed]);

  const check = async (address: string) => {
    setChecks((last) => ({ ...last, [address]: "Checking…" }));
    try {
      const answer = await connectGrafana(address);
      setChecks((last) => ({ ...last, [address]: connectedText(answer) }));
    } catch (reason) {
      setChecks((last) => ({ ...last, [address]: message(reason) }));
    }
  };
  const remove = async (address: string) => {
    try {
      setSites((await removeGrafana(address)).sites);
    } catch (reason) {
      setFailure(message(reason));
    }
  };

  return (
    <Section
      id="grafana"
      title="Grafana"
      note="Charts in replies can draw Grafana panels. Med reads them with a token that stays on this computer: it never goes into a transcript or to an agent."
    >
      {failure && (
        <p role="alert" {...stylex.props(styles.error, styles.pad)}>
          {failure}
        </p>
      )}
      {sites?.map((site) => (
        <Row
          key={site.address}
          label={shortAddress(site.address)}
          note={
            checks[site.address] ??
            (site.keychain
              ? `Token in Keychain item ${site.keychain}`
              : site.token
                ? `Token ending ${site.hint}`
                : "No token: add one below to draw its panels.")
          }
        >
          <div {...stylex.props(styles.controls)}>
            {site.token && (
              <button
                type="button"
                onClick={() => void check(site.address)}
                {...stylex.props(settingStyles.link)}
              >
                Check
              </button>
            )}
            <button
              type="button"
              aria-label={`Remove ${shortAddress(site.address)}`}
              onClick={() => void remove(site.address)}
              {...stylex.props(settingStyles.link)}
            >
              Remove
            </button>
          </div>
        </Row>
      ))}
      {sites && (
        <Connect
          first={sites.length === 0}
          onConnected={(site, text) => {
            setSites((last) => [
              ...(last ?? []).filter((entry) => entry.address !== site.address),
              site,
            ]);
            setChecks((last) => ({ ...last, [site.address]: text }));
          }}
        />
      )}
    </Section>
  );
}

function connectedText({ organization, version }: { organization?: string; version?: string }) {
  const parts = [organization && `Connected to ${organization}`, version && `Grafana ${version}`];
  return parts.filter(Boolean).join(" · ") || "Connected";
}

type TokenFrom = "keychain" | "paste";

function Connect({
  first,
  onConnected,
}: {
  first: boolean;
  onConnected(site: GrafanaSite, text: string): void;
}) {
  const [address, setAddress] = useState("");
  const [from, setFrom] = useState<TokenFrom>("keychain");
  const [token, setToken] = useState("");
  const [item, setItem] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const secret = from === "keychain" ? item : token;
  const ready = /^https?:\/\/\S+$/.test(address.trim()) && secret.trim() !== "" && !busy;
  const command = keychainCommand(item.trim() || "grafana-acme");
  const connect = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await connectGrafana(
        address.trim(),
        from === "keychain" ? { keychain: item.trim() } : { token: token.trim() },
      );
      onConnected(answer.site, connectedText(answer));
      setAddress("");
      setToken("");
      setItem("");
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Row
      block
      label={first ? "Connect a Grafana" : "Add another Grafana"}
      note="A service account token with the Viewer role is enough. In Grafana: Administration → Users and access → Service accounts → Add service account, then Add service account token."
    >
      <div role="radiogroup" aria-label="Where the token is" {...stylex.props(styles.choice)}>
        {(
          [
            ["keychain", "In my Keychain"],
            ["paste", "Paste it here"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={from === value}
            onClick={() => {
              setFrom(value);
              setError(null);
            }}
            {...stylex.props(styles.option, from === value && styles.optionOn)}
          >
            {label}
          </button>
        ))}
      </div>
      {from === "keychain" && (
        <div {...stylex.props(styles.steps)}>
          <p {...stylex.props(styles.step)}>
            Add the token to your Keychain once, in Terminal. It asks for the token, so it stays out
            of your shell's history:
          </p>
          <div {...stylex.props(styles.command)}>
            <code {...stylex.props(styles.code)}>{command}</code>
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard.writeText(command).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
              {...stylex.props(settingStyles.link)}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p {...stylex.props(styles.step)}>
            Then name the item here. Med reads the token from the Keychain when a chart needs it,
            and keeps no copy.
          </p>
        </div>
      )}
      <form
        {...stylex.props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        <input
          type="url"
          aria-label="Grafana address"
          placeholder="https://grafana.example.com"
          value={address}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setAddress(event.target.value)}
          {...stylex.props(styles.input, styles.address)}
        />
        {from === "keychain" ? (
          <input
            type="text"
            aria-label="Keychain item"
            placeholder="grafana-acme"
            value={item}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setItem(event.target.value)}
            {...stylex.props(styles.input, styles.token)}
          />
        ) : (
          <input
            type="password"
            aria-label="Grafana token"
            placeholder="glsa_…"
            value={token}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setToken(event.target.value)}
            {...stylex.props(styles.input, styles.token)}
          />
        )}
        <button type="submit" disabled={!ready} {...stylex.props(settingStyles.link, styles.add)}>
          {busy ? "Checking…" : "Connect"}
        </button>
      </form>
      {error && (
        <p role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      )}
    </Row>
  );
}

const styles = stylex.create({
  pad: { paddingTop: 14 },
  error: { margin: 0, color: tokens.red, fontSize: 13, lineHeight: 1.5 },
  controls: { display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 },
  form: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  input: {
    boxSizing: "border-box",
    height: 32,
    minWidth: 0,
    paddingInline: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: tokens.line, ":focus": tokens.accentLine },
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.canvas,
    color: tokens.text,
    fontFamily: tokens.code,
    fontSize: 12.5,
    outline: "none",
  },
  address: { flexGrow: 2, flexShrink: 1, flexBasis: 220 },
  token: { flexGrow: 1, flexShrink: 1, flexBasis: 160 },
  choice: {
    display: "inline-flex",
    alignSelf: "flex-start",
    padding: 2,
    gap: 2,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.fill,
  },
  option: {
    height: 26,
    paddingInline: 10,
    borderWidth: 0,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: "transparent",
    color: tokens.muted,
    font: "inherit",
    fontSize: 12.5,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  optionOn: { backgroundColor: tokens.canvas, color: tokens.text, boxShadow: tokens.shadow },
  steps: { display: "flex", flexDirection: "column", gap: 8 },
  step: { margin: 0, color: tokens.muted, fontSize: 13, lineHeight: 1.5 },
  command: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  code: {
    flexGrow: 1,
    minWidth: 0,
    paddingBlock: 6,
    paddingInline: 10,
    overflowX: "auto",
    whiteSpace: "nowrap",
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.canvas,
    color: tokens.text,
    fontFamily: tokens.code,
    fontSize: 12.5,
  },
  add: {
    opacity: { default: 1, ":disabled": 0.45 },
    cursor: { default: "pointer", ":disabled": "default" },
  },
});
