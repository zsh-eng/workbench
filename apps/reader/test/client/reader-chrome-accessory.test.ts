import { createElement } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReaderChromeAccessory } from "@/features/reader/ReaderChromeAccessory";

afterEach(cleanup);

it("disables duplicate saves and keeps an unsuccessful save available to retry or dismiss", () => {
  const prompt = {
    previousStatus: null,
    title: "Ready to start reading?",
    actionLabel: "Start reading",
    error: "",
    isPending: true,
    onConfirm: vi.fn(),
    onDismiss: vi.fn(),
  };
  const view = render(
    createElement(ReaderChromeAccessory, { kind: "reading", prompt }),
  );
  const action = view.getByRole("button", {
    name: "Mark as reading",
    exact: true,
  }) as HTMLButtonElement;
  expect(action.disabled).toBe(true);
  fireEvent.click(action);
  expect(prompt.onConfirm).not.toHaveBeenCalled();
  view.rerender(
    createElement(ReaderChromeAccessory, {
      kind: "reading",
      prompt: {
        ...prompt,
        isPending: false,
        error: "Couldn’t update reading status. Try again.",
      },
    }),
  );
  expect(action.disabled).toBe(false);
  expect(action.getAttribute("aria-describedby")?.split(" ")).toContain(
    view.getByRole("alert").id,
  );
  fireEvent.click(action);
  expect(prompt.onConfirm).toHaveBeenCalledOnce();
  fireEvent.click(
    view.getByRole("button", { name: "Dismiss reading status prompt" }),
  );
  expect(prompt.onDismiss).toHaveBeenCalledOnce();
});
