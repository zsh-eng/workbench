import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import { createApi, openInHostsSchema, type OpenInHosts } from "../../data/api";
import { readBrowserToken } from "../../data/auth";
import { useSettingsFile, writeSetting } from "../../data/settings-file";
import { tokens } from "../../theme.stylex";
import { ChoiceSelect } from "../Controls";
import { Group, Row, Section, settingStyles, Switch } from "./SettingsParts";

// Open in's settings: the kind of each code host in the sources' remotes,
// Sourcegraph's address, the editors to list, and other links. Med reads
// them on the host, from the settings file's `openIn` keys.

type Kind = "github" | "gitlab" | "off";
const KINDS: { value: Kind; label: string }[] = [
  { value: "github", label: "GitHub" },
  { value: "gitlab", label: "GitLab" },
  { value: "off", label: "Leave out" },
];
const PLACES = "{host}, {owner}, {repo}, {ref}, {path}, and {line}";

const words = (value: unknown): Record<string, string> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : {};

export function OpenInSettings() {
  const file = useSettingsFile();
  const [found, setFound] = useState<OpenInHosts | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    createApi(fetch.bind(globalThis), readBrowserToken())
      .json("/api/open-in/hosts", openInHostsSchema, { signal: controller.signal })
      .then(setFound, () => {
        if (!controller.signal.aborted) setFound({ hosts: [], editors: [] });
      });
    return () => controller.abort();
  }, []);
  const settings = file?.settings ?? {};
  const hosts = words(settings["openIn.hosts"]);
  const links = words(settings["openIn.links"]);
  const listed = Array.isArray(settings["openIn.editors"]) ? settings["openIn.editors"] : null;
  const write = (key: string, value: Parameters<typeof writeSetting>[1]) =>
    void writeSetting(key, value).then(
      () => setError(null),
      (reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Med could not save the setting."),
    );
  const editors = found?.editors ?? [];
  // Unset, Open in lists each editor found, in Med's order.
  const shown = (listed ?? editors.map((editor) => editor.id)).filter((id) =>
    editors.some((editor) => editor.id === id),
  );
  const rank = (id: string) =>
    shown.includes(id)
      ? shown.indexOf(id)
      : shown.length + editors.findIndex((editor) => editor.id === id);
  return (
    <Section
      id="open-in"
      title="Open in"
      note="Where Open in sends a file's line. Med reads the code hosts from your repositories' remotes, and finds the editors on this Mac."
      grouped
    >
      {error && (
        <p role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      )}
      <Group title="Code hosts">
        {!found && <Row label="Reading your remotes…" />}
        {found && found.hosts.length === 0 && (
          <Row label="No code hosts yet" note="A repository with a remote adds its host here." />
        )}
        {found?.hosts.map((entry) => {
          const chosen = hosts[entry.host] as Kind | undefined;
          const count = `${entry.repositories} ${entry.repositories === 1 ? "repository" : "repositories"}`;
          const note = chosen
            ? `${KINDS.find((kind) => kind.value === chosen)?.label ?? chosen} · ${count}`
            : entry.github
              ? `${entry.host === "github.com" ? "GitHub" : "GitHub Enterprise, found through its API"} · ${count}`
              : `Not recognised, so Open in leaves it out until you choose · ${count}`;
          return (
            <Row key={entry.host} label={entry.host} note={note}>
              <ChoiceSelect
                trigger={settingStyles.select}
                label={`Kind of ${entry.host}`}
                value={chosen ?? (entry.github ? "github" : "")}
                display={chosen || entry.github ? undefined : "Choose"}
                choices={KINDS}
                onChange={(value) => write("openIn.hosts", { ...hosts, [entry.host]: value })}
              />
            </Row>
          );
        })}
      </Group>
      <Group title="Code search">
        <Row
          label="Sourcegraph"
          note="Adds Sourcegraph to Open in, at the same line: its address, then the host, repository, and branch."
        >
          <AddressField
            label="Sourcegraph address"
            placeholder="https://sourcegraph.example.com"
            value={
              typeof settings["openIn.sourcegraph"] === "string"
                ? settings["openIn.sourcegraph"]
                : ""
            }
            onSave={(value) => write("openIn.sourcegraph", value)}
          />
        </Row>
      </Group>
      <Group title="Editors">
        {!found && <Row label="Looking for editors…" />}
        {found && editors.length === 0 && (
          <Row
            label="No editors found"
            note="Med looks for VS Code, Cursor, Zed, and IntelliJ IDEA, on your PATH and in Applications."
          />
        )}
        {/* In Open in's order, the default first, then the ones left out. */}
        {[...editors]
          .sort((a, b) => rank(a.id) - rank(b.id))
          .map((editor) => {
            const index = shown.indexOf(editor.id);
            return (
              <Row
                key={editor.id}
                label={editor.name}
                note={[
                  index === 0 ? "Default" : "",
                  editor.usage ? `Opens with ${editor.usage}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              >
                <span {...stylex.props(styles.controls)}>
                  {index > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        write("openIn.editors", [
                          editor.id,
                          ...shown.filter((id) => id !== editor.id),
                        ])
                      }
                      {...stylex.props(settingStyles.link)}
                    >
                      Make default
                    </button>
                  )}
                  <Switch
                    label={`${editor.name} in Open in`}
                    on={index >= 0}
                    toggle={() =>
                      write(
                        "openIn.editors",
                        index >= 0 ? shown.filter((id) => id !== editor.id) : [...shown, editor.id],
                      )
                    }
                  />
                </span>
              </Row>
            );
          })}
      </Group>
      <Group title="Other links">
        {Object.entries(links).map(([name, template]) => (
          <Row key={name} label={name} note={template}>
            <button
              type="button"
              aria-label={`Remove ${name}`}
              onClick={() => {
                const next = { ...links };
                delete next[name];
                write("openIn.links", next);
              }}
              {...stylex.props(settingStyles.link)}
            >
              Remove
            </button>
          </Row>
        ))}
        <Row
          label="Add a link"
          note={`For any tool that takes a file and a line: a template with ${PLACES}.`}
          block
        >
          <NewLink
            taken={(name) => name in links}
            onAdd={(name, template) => write("openIn.links", { ...links, [name]: template })}
          />
        </Row>
      </Group>
    </Section>
  );
}

const ADDRESS = /^https?:\/\/\S+$/;

/** An address that saves on Enter or when it loses focus; empty turns it off. */
function AddressField({
  label,
  placeholder,
  value,
  onSave,
}: {
  label: string;
  placeholder: string;
  value: string;
  onSave(value: string): void;
}) {
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(value);
  }
  const valid = !draft.trim() || ADDRESS.test(draft.trim());
  const save = () => {
    const next = draft.trim().replace(/\/+$/, "");
    if (valid && next !== value) onSave(next);
  };
  return (
    <input
      type="url"
      aria-label={label}
      aria-invalid={!valid}
      placeholder={placeholder}
      value={draft}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") save();
        if (event.key === "Escape") setDraft(value);
      }}
      {...stylex.props(styles.input, !valid && styles.invalid)}
    />
  );
}

function NewLink({
  taken,
  onAdd,
}: {
  taken(name: string): boolean;
  onAdd(name: string, template: string): void;
}) {
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("");
  const ready =
    name.trim() !== "" && !taken(name.trim()) && /^https?:\/\/\S+$/.test(template.trim());
  const add = () => {
    if (!ready) return;
    onAdd(name.trim(), template.trim());
    setName("");
    setTemplate("");
  };
  return (
    <form
      {...stylex.props(styles.newLink)}
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <input
        aria-label="Link name"
        placeholder="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        {...stylex.props(styles.input, styles.name)}
      />
      <input
        aria-label="Link template"
        placeholder="https://code.example.com/{repo}/{ref}/{path}#L{line}"
        value={template}
        spellCheck={false}
        onChange={(event) => setTemplate(event.target.value)}
        {...stylex.props(styles.input, styles.template)}
      />
      <button type="submit" disabled={!ready} {...stylex.props(settingStyles.link, styles.add)}>
        Add
      </button>
    </form>
  );
}

const styles = stylex.create({
  error: { margin: 0, marginBottom: 12, color: tokens.red, fontSize: 13 },
  controls: { display: "inline-flex", alignItems: "center", gap: 12, flexShrink: 0 },
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
    width: 280,
  },
  invalid: { borderColor: { default: tokens.red, ":focus": tokens.red } },
  newLink: { display: "flex", gap: 8, alignItems: "center" },
  name: { width: 140, flexShrink: 0, fontFamily: tokens.ui, fontSize: 13 },
  template: { flex: "1", width: "auto" },
  add: {
    opacity: { default: 1, ":disabled": 0.45 },
    cursor: { default: "pointer", ":disabled": "default" },
  },
});
