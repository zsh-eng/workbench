import { afterAll, expect, test } from "bun:test";
import { act, type ComponentType } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { click, render } from "./dom";

const globals = ["IntersectionObserver", "matchMedia", "fetch"] as const;
const saved = globals.map((key) =>
  Object.getOwnPropertyDescriptor(globalThis, key),
);
function stub(key: (typeof globals)[number], value: unknown) {
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });
}
// Frames and autoplay start from IntersectionObserver; nothing is in view
// here, so the frames do not load and only the controls move the demos.
stub(
  "IntersectionObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
// Reduced motion: demos rest at their last moment and do not start by themselves.
stub("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
// The app's account check asks for /me when it loads. Record every request,
// so the test can show that no specimen writes.
const requests: string[] = [];
stub("fetch", async (url: string | URL | Request, init?: RequestInit) => {
  requests.push(`${init?.method ?? "GET"} ${String(url)}`);
  return new Response(null, { status: 401 });
});
afterAll(() => {
  globals.forEach((key, index) => {
    const descriptor = saved[index];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
});

// Loaded after the stubs, as App loads it lazily.
const { default: ElementsRoutes }: { default: ComponentType } = await import(
  "@/elements/ElementsRoutes"
);

function elementsAt(path: string) {
  window.history.replaceState(null, "", path);
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/debug/elements/*" element={<ElementsRoutes />} />
      </Routes>
    </MemoryRouter>
  );
}

function specimen(root: HTMLElement, title: string) {
  const heading = [...root.querySelectorAll("figure h3")].find(
    (node) => node.textContent === title,
  );
  return heading!.closest("figure") as HTMLElement;
}

function button(root: HTMLElement, name: string) {
  return [...root.querySelectorAll("button")].find(
    (node) =>
      node.textContent === name || node.getAttribute("aria-label") === name,
  ) as HTMLButtonElement;
}

test("Elements shows sample specimens, changes states, drives demos and frames", async () => {
  const page = await render(elementsAt("/debug/elements"));
  try {
    const sections = [...page.container.querySelectorAll("main > section")];
    expect(sections.map((section) => section.id)).toEqual([
      "foundations",
      "controls",
      "flashcard",
      "decks",
      "feedback",
      "review",
      "create",
      "stats",
      "live-app",
    ]);
    // With reduced motion a timeline shows its last moment, ready to replay.
    const motion = specimen(page.container, "Motion");
    expect(button(motion, "Replay").dataset.action).toBe("replay");

    const content = specimen(page.container, "Flashcard content");
    expect(content.querySelector(".katex")).toBeNull();
    await click(button(content, "Maths"));
    expect(content.querySelector(".katex-display")).not.toBeNull();
    expect(button(content, "Maths").getAttribute("aria-pressed")).toBe("true");

    // Choosing a state replays the card's fade. Home goes back to the start,
    // and Shift+Right moves to the next beat and holds the card there.
    const slider = content.querySelector<HTMLElement>('[role="slider"]')!;
    const press = (key: string, shiftKey = false) =>
      act(async () => {
        slider.dispatchEvent(
          new KeyboardEvent("keydown", { key, shiftKey, bubbles: true }),
        );
      });
    await press("Home");
    expect(slider.getAttribute("aria-valuenow")).toBe("0");
    await press("ArrowRight", true);
    expect(slider.getAttribute("aria-valuenow")).toBe("0.15");
    expect(slider.getAttribute("aria-valuetext")).toContain("Half in");
    expect(button(content, "Play").dataset.action).toBe("play");

    // Frame specimens wait out of view instead of loading the app.
    expect(page.container.querySelectorAll("iframe")).toHaveLength(0);
  } finally {
    await page.unmount();
  }

  const frame = await render(
    elementsAt("/debug/elements/frame/review?state=done"),
  );
  try {
    expect(frame.container.textContent).toContain("You're done for now!");
    await act(async () => {
      window.dispatchEvent(
        new window.MessageEvent("message", {
          origin: location.origin,
          data: { type: "elements:state", state: "question", nonce: 1 },
        }),
      );
    });
    expect(frame.container.textContent).toContain(
      "What does spaced repetition schedule?",
    );
  } finally {
    await frame.unmount();
    window.history.replaceState(null, "", "/");
  }
  expect(requests.filter((request) => !request.startsWith("GET "))).toEqual([]);
});
