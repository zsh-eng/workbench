import { ChevronLeft } from "lucide-react";
import { useEffect, useId, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { countKept, downloadAll, stopDownload, useOffline } from "./offline";
import {
  FONTS,
  SIZES,
  updateSettings,
  useSettings,
  type Settings,
} from "./settings";
import { useArticles, useSession } from "./state";
import { AccountMenu } from "./ui";

export function SettingsPage() {
  const navigate = useNavigate();
  const settings = useSettings();
  useEffect(() => {
    document.title = "Settings – Arctic";
    return () => {
      document.title = "Arctic";
    };
  }, []);
  return (
    <>
      <div className="bar">
        <button type="button" className="back" onClick={() => navigate("/")}>
          <ChevronLeft size={20} /> Library
        </button>
        <span className="spacer" />
        <AccountMenu />
      </div>
      <main className="page settings">
        <h1>Settings</h1>
        <p>These settings belong to this browser.</p>

        <section className="section">
          <h2>Display</h2>
          <AppearanceControls />
        </section>

        <section className="section">
          <h2>Reading</h2>
          <ReadingControls />
          <p className="sample">
            The ice keeps its own calendar. Each winter it grows from the edges
            of the land, and each summer it gives back a little less than it
            took.
          </p>
        </section>

        <section className="section">
          <h2>Library</h2>
          <Field label="Layout">
            <Choice
              label="Layout"
              value={settings.layout}
              options={[
                ["cards", "Cards"],
                ["list", "List"],
              ]}
              onChange={(layout) => updateSettings({ layout })}
            />
          </Field>
        </section>

        <OfflineSection />
      </main>
    </>
  );
}

export function AppearanceControls() {
  const settings = useSettings();
  return (
    <>
      <Field label="Appearance">
        <Choice
          label="Appearance"
          value={settings.appearance}
          options={[
            ["system", "System"],
            ["light", "Light"],
            ["dark", "Dark"],
          ]}
          onChange={(appearance) => updateSettings({ appearance })}
        />
      </Field>
      <Field label="Theme">
        <Choice
          label="Theme"
          value={settings.theme}
          className="swatches"
          options={[
            ["arctic", <Swatch theme="arctic" label="Arctic" />],
            ["flexoki", <Swatch theme="flexoki" label="Flexoki" />],
            ["night", <Swatch theme="night" label="Night" />],
          ]}
          onChange={(theme) => updateSettings({ theme })}
        />
      </Field>
    </>
  );
}

/** A theme's day and night palettes, side by side. */
function Swatch({ theme, label }: { theme: Settings["theme"]; label: string }) {
  return (
    <>
      <span className="swatch" data-swatch={theme} aria-hidden>
        <span>Aa</span>
        <span>Aa</span>
      </span>
      {label}
    </>
  );
}

export function ReadingControls() {
  const settings = useSettings();
  const step = (by: number) =>
    updateSettings({
      size: Math.min(SIZES.max, Math.max(SIZES.min, settings.size + by)),
    });
  return (
    <>
      <Field label="Font">
        <Choice
          label="Font"
          value={settings.font}
          className="fonts"
          options={(Object.keys(FONTS) as Settings["font"][]).map((font) => [
            font,
            <>
              <span className="glyph" style={{ fontFamily: FONTS[font].stack }}>
                Ag
              </span>
              {FONTS[font].label}
            </>,
          ])}
          onChange={(font) => updateSettings({ font })}
        />
      </Field>
      <Field label="Text size">
        <div className="stepper">
          <button
            type="button"
            aria-label="Smaller text"
            disabled={settings.size <= SIZES.min}
            onClick={() => step(-1)}
          >
            <span style={{ fontSize: 13 }}>A</span>
          </button>
          <output aria-live="polite">{settings.size}</output>
          <button
            type="button"
            aria-label="Larger text"
            disabled={settings.size >= SIZES.max}
            onClick={() => step(1)}
          >
            <span style={{ fontSize: 19 }}>A</span>
          </button>
        </div>
      </Field>
      <Field label="Line spacing">
        <Choice
          label="Line spacing"
          value={settings.spacing}
          options={[
            ["tight", "Tight"],
            ["normal", "Normal"],
            ["loose", "Loose"],
          ]}
          onChange={(spacing) => updateSettings({ spacing })}
        />
      </Field>
      <Field label="Width">
        <Choice
          label="Width"
          value={settings.width}
          options={[
            ["narrow", "Narrow"],
            ["normal", "Normal"],
            ["wide", "Wide"],
          ]}
          onChange={(width) => updateSettings({ width })}
        />
      </Field>
      <Field label="Alignment">
        <Choice
          label="Alignment"
          value={settings.align}
          options={[
            ["left", "Left"],
            ["justify", "Justified"],
          ]}
          onChange={(align) => updateSettings({ align })}
        />
      </Field>
    </>
  );
}

function OfflineSection() {
  const session = useSession();
  const articles = useArticles();
  const settings = useSettings();
  const offline = useOffline();
  const missing = offline.total - offline.kept;
  useEffect(() => {
    if (!offline.running) void countKept(session, articles);
  }, [session, articles, offline.running]);
  const id = useId();
  return (
    <section className="section">
      <h2>Offline</h2>
      <p>
        Keep the text of saved articles in this browser, to read without a
        connection. Images still load from each publisher.
      </p>
      <div className="offline">
        <div className="offline-status">
          <strong>
            {offline.kept.toLocaleString()} of {offline.total.toLocaleString()}
          </strong>{" "}
          texts on this device
          {offline.bytes > 0 && <span> · {megabytes(offline.bytes)}</span>}
          {offline.failed > 0 && (
            <span>
              {" "}
              · {offline.failed} could not download
            </span>
          )}
        </div>
        <progress
          max={offline.total || 1}
          value={offline.kept}
          aria-label="Texts on this device"
        />
        <div className="row-actions">
          {offline.running ? (
            <button type="button" className="button" onClick={stopDownload}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="button primary"
              disabled={missing === 0}
              onClick={() => void downloadAll(session, articles)}
            >
              {missing === 0
                ? "All text is on this device"
                : `Download ${missing.toLocaleString()} ${missing === 1 ? "text" : "texts"}`}
            </button>
          )}
        </div>
      </div>
      <label className="check" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={settings.offline}
          onChange={(event) => {
            updateSettings({ offline: event.target.checked });
            if (event.target.checked) void downloadAll(session, articles);
          }}
        />
        Download new text after each sync
      </label>
    </section>
  );
}

const megabytes = (bytes: number) =>
  bytes < 1_000_000
    ? `${Math.max(1, Math.round(bytes / 1000))} kB`
    : `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
    </div>
  );
}

/** A row of options as radio buttons: arrow keys move between them. */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  className = "segmented",
}: {
  label: string;
  value: T;
  options: [T, ReactNode][];
  onChange: (value: T) => void;
  className?: string;
}) {
  const group = useId();
  return (
    <div className={className} role="radiogroup" aria-label={label}>
      {options.map(([option, content]) => (
        <label key={option}>
          <input
            type="radio"
            name={group}
            value={option}
            checked={value === option}
            onChange={() => onChange(option)}
          />
          {content}
        </label>
      ))}
    </div>
  );
}
