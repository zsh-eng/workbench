import { Switch } from "@/components/ui/switch";
import {
  arrivingBooks,
  offlineDownloads,
  useDebugSwitch,
  type DebugSwitch,
} from "@/lib/debug-switch";

const TRIALS: {
  id: string;
  title: string;
  description: string;
  switch: DebugSwitch;
}[] = [
  {
    id: "offline-downloads",
    title: "Offline downloads",
    description:
      "Library → Sort and layout → Download all for offline. Each cover fills as its book downloads, and a glyph beside your account opens the activity sheet.",
    switch: offlineDownloads,
  },
  {
    id: "arriving-books",
    title: "Arriving books",
    description:
      "Books you add hold their place in the Library at once, and each cover develops from black and white as the book is prepared. Design ideas → Arriving books compares the looks.",
    switch: arrivingBooks,
  },
];

function TrialRow({ trial }: { trial: (typeof TRIALS)[number] }) {
  const checked = useDebugSwitch(trial.switch);
  return (
    <li className="flex items-center gap-4 px-4 py-3.5">
      <span className="min-w-0 flex-1">
        <label
          htmlFor={trial.id}
          className="block text-sm font-medium text-foreground"
        >
          {trial.title}
        </label>
        <span
          id={`${trial.id}-description`}
          className="mt-0.5 block text-xs text-muted-foreground"
        >
          {trial.description}
        </span>
      </span>
      <Switch
        id={trial.id}
        aria-describedby={`${trial.id}-description`}
        checked={checked}
        onCheckedChange={trial.switch.set}
      />
    </li>
  );
}

/** Background activity trials, off until you turn them on here. */
export function BackgroundActivityTrials() {
  return (
    <section className="mb-8">
      <h2 className="mb-2 ml-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
        Try on this device
      </h2>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
        {TRIALS.map((trial) => (
          <TrialRow key={trial.id} trial={trial} />
        ))}
      </ul>
    </section>
  );
}
