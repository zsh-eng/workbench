import { copyText } from "@/lib/clipboard";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalClipboard = navigator.clipboard;

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: originalClipboard,
  });
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("copyText", () => {
  it("copies through the copy command without the Clipboard API, and gives back the page selection", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    const page = document.createElement("p");
    page.textContent = "A passage on the page";
    document.body.append(page);
    const selected = document.createRange();
    selected.setStart(page.firstChild!, 2);
    selected.setEnd(page.firstChild!, 9);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(selected);

    let copied = "";
    const execCommand = vi.fn((command: string) => {
      const field = document.activeElement as HTMLTextAreaElement;
      copied = field.value.slice(field.selectionStart, field.selectionEnd);
      return command === "copy";
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    await expect(copyText("The whole passage, past the page")).resolves.toBe(
      true,
    );
    expect(copied).toBe("The whole passage, past the page");
    expect(getSelection()!.toString()).toBe("passage");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("reports a refused write", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) },
    });
    await expect(copyText("A passage")).resolves.toBe(false);
  });
});
