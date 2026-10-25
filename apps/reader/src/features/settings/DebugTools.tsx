import { BackToLibrary } from "@/components/ui/back-to-library";
import { getLabRuntime } from "@/features/sync-lab/runtime";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

interface DebugTool {
  title: string;
  description: string;
  to: string;
  /** Sync Lab is a separate document, so it needs a full page load. */
  reload?: boolean;
}

const GROUPS: { title: string; tools: DebugTool[] }[] = [
  {
    title: "Measure",
    tools: [
      {
        title: "Performance",
        description: "Reader traces: open, pagination, and settled content.",
        to: "/reader-traces",
      },
      {
        title: "Reader diagnostics",
        description: "Scan pages and layout invariants under fixed profiles.",
        to: "/diagnostics/reader",
      },
    ],
  },
  {
    title: "Design",
    tools: [
      {
        title: "Elements",
        description:
          "Reader parts on desktop and phone side by side, with their states.",
        to: "/debug/elements",
      },
      {
        title: "Design ideas",
        description:
          "New designs for the Library, Reader, reading fonts, paper, dark mode and living covers next to what ships, with your books.",
        to: "/debug/elements/reader",
      },
      {
        title: "Design experiments",
        description:
          "Interactive studies for the Reader, Library, Highlights, and Sessions.",
        to: "/debug/experiments",
      },
      {
        title: "Notes Lab",
        description: "Prototypes for capturing, writing, and revisiting notes.",
        to: "/debug/notes-lab",
      },
      {
        title: "Chrome accessories",
        description: "Reading and sync prompts, appearance, and dismissal.",
        to: "/debug/chrome-accessories",
      },
    ],
  },
  {
    title: "Behaviour",
    tools: [
      {
        title: "Jump history",
        description: "Run jumps, step through examples, inspect the history.",
        to: "/debug/jump-history",
      },
      {
        title: "Sync Lab",
        description:
          "Spawn isolated clients, inspect sync, and test offline changes.",
        to: "/debug/sync",
        reload: true,
      },
    ],
  },
];

const ROW =
  "flex items-center gap-4 px-4 py-3.5 outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05]";

/** Every diagnostic and design tool, one link each. Debug mode only. */
export function DebugTools() {
  const inLab = Boolean(getLabRuntime());
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 pt-16 pb-16 md:px-6 md:py-10">
        <header className="mb-8">
          <div className="grid grid-cols-[2rem_1fr_2rem] items-center gap-3 md:block">
            <BackToLibrary />
            <h1 className="text-center text-2xl font-bold tracking-tight text-foreground md:text-left">
              Debug tools
            </h1>
            <div className="size-8 md:hidden" aria-hidden="true" />
          </div>
          <p className="mt-1 text-center text-sm text-muted-foreground md:text-left">
            Diagnostics and design studies. Turn Debug mode off in Settings to
            hide them.
          </p>
        </header>
        {GROUPS.map((group) => {
          const tools = group.tools.filter((tool) => !(tool.reload && inLab));
          return (
            <section key={group.title} className="mb-8">
              <h2 className="mb-2 ml-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                {group.title}
              </h2>
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
                {tools.map((tool) => {
                  const body = (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">
                          {tool.title}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {tool.description}
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </>
                  );
                  return (
                    <li key={tool.to}>
                      {tool.reload ? (
                        <a href={tool.to} className={ROW}>
                          {body}
                        </a>
                      ) : (
                        <Link to={tool.to} className={ROW}>
                          {body}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
