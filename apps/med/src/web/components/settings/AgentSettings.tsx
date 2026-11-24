import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import {
  AUTO_COMPACT_AGENTS,
  AUTO_COMPACT_CHOICES,
  autoCompactKey,
  autoCompactOf,
} from "../../../shared/agent-defaults";
import { useAgentPresets } from "../../data/owned-session";
import { useSettingsFile, writeSetting } from "../../data/settings-file";
import { tokens } from "../../theme.stylex";
import { ChoiceSelect } from "../Controls";
import { tokenCount } from "../session/ThreadUsage";
import { Row, Section, settingStyles } from "./SettingsParts";

/** When each agent takes a change: Claude Code and Codex as they start, Pi
 * and Antigravity at a turn's end (agent-defaults.ts). */
const TAKES: Record<string, string> = {
  claude: "From its next session",
  codex: "From its next session",
  pi: "Med compacts after a turn past it",
  agy: "Med compacts after a turn past it",
};

/** Each agent installed here, and where it compacts its context. */
export function AgentSettings({ fetcher }: { fetcher?: typeof fetch }) {
  const file = useSettingsFile();
  const presets = useAgentPresets(true, fetcher);
  const [error, setError] = useState<string | null>(null);
  const agents = AUTO_COMPACT_AGENTS.flatMap(
    (id) => presets?.filter((preset) => preset.id === id && preset.available) ?? [],
  );
  // The section shows while the agents load, so /settings/agents scrolls to it.
  if (!file || (presets && !agents.length)) return null;
  const write = (key: string, value: number | null) =>
    void writeSetting(key, value, fetcher).then(
      () => setError(null),
      (reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Med could not save the setting."),
    );
  return (
    <Section
      id="agents"
      title="Agents"
      note="Where each agent compacts its context, in the sessions that Med starts."
    >
      {error && (
        <p role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      )}
      {agents.map((agent) => {
        const at = autoCompactOf(file.settings, agent.id);
        const choices = [
          { value: "default", label: "Default" },
          ...[...new Set([...AUTO_COMPACT_CHOICES, ...(at ? [at] : [])])]
            .sort((a, b) => a - b)
            .map((value) => ({ value: String(value), label: tokenCount(value) })),
        ];
        return (
          <Row key={agent.id} label={agent.name} note={TAKES[agent.id]}>
            <ChoiceSelect
              trigger={settingStyles.select}
              align="end"
              label={`${agent.name} autocompact`}
              value={at ? String(at) : "default"}
              choices={choices}
              onChange={(value) =>
                write(autoCompactKey(agent.id), value === "default" ? null : Number(value))
              }
            />
          </Row>
        );
      })}
    </Section>
  );
}

const styles = stylex.create({
  error: { margin: 0, color: tokens.red, fontSize: 13, lineHeight: 1.5 },
});
