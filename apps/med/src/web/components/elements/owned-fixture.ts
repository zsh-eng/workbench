import type { AgentInboxState, AgentMessage, AgentMessageInput } from "../../../shared/agent-inbox";
import type { SessionEvent, SessionUpdate } from "../../../shared/agent-session";
import type { AgentPreset, OwnedAction, OwnedState } from "../../../shared/owned-session";

/**
 * A scripted agent behind a fake host, so the Elements page shows the real
 * Session pane: its thread, the pickers, the `/` menu, a permission request,
 * and Stop. Each message reads a file, asks to edit it, and replies.
 */

export const demoAgents: AgentPreset[] = [
  { id: "claude", name: "Claude Code", kind: "claude", available: true },
  { id: "opencode", name: "OpenCode", kind: "acp", available: true },
  { id: "codex", name: "Codex", kind: "acp", available: false },
];

const CLAUDE_SETTINGS: OwnedState["settings"] = [
  {
    id: "model",
    name: "Model",
    category: "model",
    value: "default",
    options: [
      { value: "default", name: "Default", description: "The recommended model" },
      { value: "opus", name: "Opus", description: "For the hardest work" },
      { value: "sonnet", name: "Sonnet", description: "For everyday work" },
      { value: "haiku", name: "Haiku", description: "For quick answers" },
    ],
  },
  {
    id: "effort",
    name: "Effort",
    category: "effort",
    value: "default",
    idleOnly: true,
    options: [
      { value: "default", name: "Default effort" },
      { value: "low", name: "Low" },
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
    ],
  },
  {
    id: "mode",
    name: "Mode",
    category: "mode",
    value: "default",
    options: [
      { value: "default", name: "Ask", description: "Ask before edits and commands" },
      { value: "acceptEdits", name: "Accept edits", description: "Edit files without asking" },
      { value: "plan", name: "Plan", description: "Plan first; do not edit" },
    ],
  },
];
const ACP_SETTINGS: OwnedState["settings"] = [
  {
    id: "model",
    name: "Model",
    category: "model",
    value: "anthropic/claude-sonnet",
    options: [
      { value: "anthropic/claude-sonnet", name: "Anthropic/Claude Sonnet" },
      { value: "openai/gpt", name: "OpenAI/GPT" },
      { value: "google/gemini-pro", name: "Google/Gemini Pro" },
    ],
  },
  {
    id: "mode",
    name: "Mode",
    category: "mode",
    value: "build",
    options: [
      { value: "build", name: "Build" },
      { value: "plan", name: "Plan" },
    ],
  },
];
const COMMANDS: OwnedState["commands"] = [
  { name: "review", description: "Review the current changes" },
  { name: "simplify", description: "Simplify the changed code" },
  { name: "release-notes", description: "Draft release notes", hint: "<version>" },
  { name: "test-plan", description: "Write a test plan for this branch" },
];

const FILE = "src/web/data/relative-time.ts";
const REPLY = `Weeks now come before months in \`relativeTime\`, so 20 days reads **3 weeks ago**.

- [relative-time.ts:14](${FILE}:14) adds the week step.
- The tests cover 6, 7, and 29 days.`;
const encoder = new TextEncoder();

export function createDemoAgent(
  preset: AgentPreset,
  options: { drafts?: AgentInboxState["drafts"] } = {},
) {
  const sessionId = `demo-${preset.id}`;
  const name = preset.kind === "claude" ? "Claude Code" : preset.name;
  let state: OwnedState = {
    sessionId,
    preset: preset.id,
    name,
    status: "idle",
    settings: structuredClone(preset.kind === "claude" ? CLAUDE_SETTINGS : ACP_SETTINGS),
    commands: COMMANDS,
    context: { used: 31_000, total: 200_000 },
    turns: 0,
  };
  const events: SessionEvent[] = [];
  const stateListeners = new Set<() => void>();
  const eventListeners = new Set<(events: SessionEvent[]) => void>();
  let inbox: AgentInboxState = { messages: [], waiting: [], drafts: options.drafts ?? [] };
  const inboxListeners = new Set<() => void>();
  let timers: ReturnType<typeof setTimeout>[] = [];
  let answer: ((option: string) => void) | undefined;

  const set = (change: Partial<OwnedState>) => {
    state = { ...state, ...change };
    for (const listener of stateListeners) listener();
  };
  const push = (update: SessionUpdate) => {
    const event = { at: Date.now(), update };
    events.push(event);
    for (const listener of eventListeners) listener([event]);
  };
  const later = (ms: number, run: () => void) => timers.push(setTimeout(run, ms));
  const setting = (id: string) => state.settings.find((entry) => entry.id === id)?.value;

  const reply = (turn: number) => {
    const words = REPLY.split(/(?<= )/);
    words.forEach((word, index) =>
      later(index * 35, () =>
        push({
          sessionUpdate: "agent_message_chunk",
          messageId: `reply-${turn}`,
          content: { type: "text", text: word },
        }),
      ),
    );
    later(words.length * 35 + 100, () =>
      set({
        status: "idle",
        context: { used: state.context!.used + 9_000, total: state.context!.total },
      }),
    );
  };
  const edit = (turn: number) => {
    push({
      sessionUpdate: "tool_call",
      toolCallId: `edit-${turn}`,
      title: `Edit ${FILE}`,
      kind: "edit",
      status: "completed",
      content: [
        {
          type: "diff",
          path: FILE,
          oldText: "  if (days < 30) return `${days} days ago`;\n",
          newText:
            "  if (days < 7) return `${days} days ago`;\n  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;\n",
        },
      ],
    });
    later(400, () => reply(turn));
  };
  const run = (text: string) => {
    const turn = state.turns + 1;
    push({ sessionUpdate: "user_message_chunk", content: { type: "text", text } });
    set({ status: "working", turns: turn });
    later(500, () =>
      push({
        sessionUpdate: "tool_call",
        toolCallId: `read-${turn}`,
        title: `Read ${FILE}`,
        kind: "read",
        status: "completed",
        locations: [{ path: FILE }],
      }),
    );
    later(1100, () => {
      if (setting("mode") === "plan") {
        push({
          sessionUpdate: "agent_message_chunk",
          messageId: `plan-${turn}`,
          content: {
            type: "text",
            text: "Plan: add a week step before months, then extend the tests. Switch to Ask or Accept edits to apply it.",
          },
        });
        set({ status: "idle" });
        return;
      }
      if (setting("mode") === "acceptEdits") return edit(turn);
      answer = (option) => {
        answer = undefined;
        set({ permission: undefined });
        if (option.startsWith("allow") || option === "always") edit(turn);
        else {
          push({
            sessionUpdate: "agent_message_chunk",
            messageId: `deny-${turn}`,
            content: { type: "text", text: "I left the file as it was. Tell me what to change." },
          });
          set({ status: "idle" });
        }
      };
      set({
        permission: {
          id: `ask-${turn}`,
          title:
            preset.kind === "claude" ? `${name} wants to use Edit` : `${name} wants to run Edit`,
          detail: FILE,
          options:
            preset.kind === "claude"
              ? [
                  { id: "allow", name: "Allow", kind: "allow_once" },
                  { id: "always", name: "Allow for this session", kind: "allow_always" },
                  { id: "deny", name: "Deny", kind: "reject_once" },
                ]
              : [
                  { id: "allow-once", name: "Allow once", kind: "allow_once" },
                  { id: "allow-always", name: "Always allow", kind: "allow_always" },
                  { id: "reject", name: "Reject", kind: "reject_once" },
                ],
        },
      });
    });
  };

  const act = (action: OwnedAction) => {
    if (action.action === "prompt") run(action.text);
    else if (action.action === "permission") answer?.(action.option);
    else if (action.action === "setting")
      set({
        settings: state.settings.map((entry) =>
          entry.id === action.id ? { ...entry, value: action.value } : entry,
        ),
      });
    else if (action.action === "interrupt") {
      for (const timer of timers) clearTimeout(timer);
      timers = [];
      answer = undefined;
      push({ sessionUpdate: "notice", title: "Interrupted", severity: "warning" });
      set({ status: "idle", permission: undefined });
    } else set({ status: "exited", permission: undefined });
  };

  const stream = (first: () => string, subscribe: (send: (text: string) => void) => () => void) => {
    let stop = () => {};
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (text: string) => controller.enqueue(encoder.encode(text));
          send(first());
          stop = subscribe(send);
        },
        cancel: () => stop(),
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  };
  const frame = (event: string, data: unknown) =>
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input), "http://demo").pathname;
    if (path === "/api/agents") return Response.json({ agents: demoAgents });
    if (path.endsWith(`/sessions/${sessionId}/events`))
      return stream(
        () =>
          frame("reset", {
            events,
            idle: state.status !== "working",
            modifiedAt: Date.now(),
            truncated: false,
          }),
        (send) => {
          const listener = (added: SessionEvent[]) =>
            send(
              frame("updates", {
                events: added,
                idle: state.status !== "working",
                modifiedAt: Date.now(),
              }),
            );
          eventListeners.add(listener);
          return () => eventListeners.delete(listener);
        },
      );
    if (path.endsWith(`/owned/${sessionId}/events`))
      return stream(
        () => frame("state", state),
        (send) => {
          const listener = () => send(frame("state", state));
          stateListeners.add(listener);
          return () => stateListeners.delete(listener);
        },
      );
    if (path.endsWith(`/owned/${sessionId}`) && init?.method === "POST") {
      act(JSON.parse(String(init.body)) as OwnedAction);
      return Response.json(state);
    }
    return Response.json({ error: { message: "Not in the demo." } }, { status: 404 });
  };

  const send = async (input: AgentMessageInput): Promise<AgentMessage> => {
    const count = input.noteIds.length;
    const text = [
      input.text,
      count ? `${count} review ${count === 1 ? "comment" : "comments"}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    run(text);
    inbox = { ...inbox, drafts: inbox.drafts.filter((draft) => !input.noteIds.includes(draft.id)) };
    for (const listener of inboxListeners) listener();
    return {
      id: `m${state.turns}`,
      sessionId,
      agent: preset.kind === "claude" ? "claude" : "acp",
      text: input.text,
      noteIds: input.noteIds,
      attachmentCount: input.attachments?.length ?? 0,
      createdAt: new Date().toISOString(),
      delivery: "delivered",
    };
  };

  return {
    session:
      preset.kind === "claude"
        ? { agent: "claude" as const, id: sessionId, cwd: "/work/trail-notes" }
        : { agent: "acp" as const, name: preset.name, id: sessionId, cwd: "/work/trail-notes" },
    fetcher,
    send,
    inbox: () => inbox,
    subscribeInbox(listener: () => void) {
      inboxListeners.add(listener);
      return () => void inboxListeners.delete(listener);
    },
    dispose() {
      for (const timer of timers) clearTimeout(timer);
    },
  };
}
export type DemoAgent = ReturnType<typeof createDemoAgent>;
