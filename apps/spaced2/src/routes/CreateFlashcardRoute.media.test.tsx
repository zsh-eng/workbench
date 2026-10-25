import { expect, spyOn, test } from "bun:test";
import { act } from "react";
import { click, input, render, until } from "../../tests/dom";
import CreateFlashcardRoute from "./CreateFlashcardRoute";

Object.assign(globalThis, { NodeFilter: window.NodeFilter });

test("upload and clipboard failures retain preview and retry without uploading a successful image twice", async () => {
  const upload = spyOn(globalThis, "fetch").mockRejectedValueOnce(
    new Error("Upload offline"),
  );
  upload.mockResolvedValue(
    new Response(JSON.stringify({ success: true, fileKey: "uploaded-key" }), {
      headers: { "Content-Type": "application/json" },
    }),
  );
  const clipboard = spyOn(
    navigator.clipboard,
    "writeText",
  ).mockRejectedValueOnce(new Error("Clipboard denied"));
  clipboard.mockResolvedValue(undefined);
  const view = await render(<CreateFlashcardRoute />);
  try {
    const front = view.container.querySelector("textarea")!;
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        items: [
          {
            type: "image/png",
            getAsFile: () => new File(["image"], "image.png"),
          },
        ],
      },
    });
    await act(async () => {
      front.dispatchEvent(paste);
    });
    expect(upload).toHaveBeenCalledTimes(0);
    const description = document.querySelector<HTMLInputElement>(
      '[aria-label="Image description"]',
    )!;
    await input(description, "Description retained");
    const form = description.closest("form")!;
    const submit = async () => {
      await act(async () => {
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      });
    };
    const alert = () => document.querySelector('[role="alert"]')?.textContent;
    const closed = () =>
      !document.querySelector('[aria-label="Image description"]');
    // The first upload compiles the hash's WebAssembly, after act() returns.
    await submit();
    await until(() => !!alert());
    expect(alert()).toContain("Upload offline");
    expect(description.value).toBe("Description retained");
    expect(upload).toHaveBeenCalledTimes(1);
    await submit();
    await until(() => !!alert()?.includes("link could not be copied"));
    expect(description.value).toBe("Description retained");
    expect(upload).toHaveBeenCalledTimes(2);
    await submit();
    await until(closed);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(clipboard).toHaveBeenCalledTimes(2);
    expect(clipboard).toHaveBeenLastCalledWith(
      expect.stringContaining("![Description retained]"),
    );
  } finally {
    await view.unmount();
    upload.mockRestore();
    clipboard.mockRestore();
  }
});

test("cancelled paste stays local and the next preview uploads only its own file and description", async () => {
  const upload = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ success: true, fileKey: "second-key" }), {
      headers: { "Content-Type": "application/json" },
    }),
  );
  const clipboard = spyOn(navigator.clipboard, "writeText").mockResolvedValue(
    undefined,
  );
  const view = await render(<CreateFlashcardRoute />);
  const pasteImage = async (name: string) => {
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        items: [
          {
            type: "image/png",
            getAsFile: () => new File([name], name, { type: "image/png" }),
          },
        ],
      },
    });
    await act(async () => {
      view.container.querySelector("textarea")!.dispatchEvent(paste);
    });
  };
  try {
    await pasteImage("cancelled.png");
    await input(
      document.querySelector<HTMLInputElement>(
        '[aria-label="Image description"]',
      )!,
      "Discarded description",
    );
    expect(document.querySelector('[role="dialog"] img')).not.toBeNull();
    expect(upload).toHaveBeenCalledTimes(0);
    const close = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent === "Close")!;
    await click(close);
    expect(
      document.querySelector('[aria-label="Image description"]'),
    ).toBeNull();
    expect(upload).toHaveBeenCalledTimes(0);
    expect(clipboard).toHaveBeenCalledTimes(0);
    await pasteImage("confirmed.png");
    const description = document.querySelector<HTMLInputElement>(
      '[aria-label="Image description"]',
    )!;
    expect(description.value).toBe("");
    expect(upload).toHaveBeenCalledTimes(0);
    await input(description, "  Confirmed description  ");
    await click(
      document.querySelector('[aria-label="Upload image and copy link"]')!,
    );
    await until(
      () => !document.querySelector('[aria-label="Image description"]'),
    );
    expect(upload).toHaveBeenCalledTimes(1);
    const request = upload.mock.calls[0][1]!;
    expect(request.method).toBe("PUT");
    expect(new TextDecoder().decode(request.body as ArrayBuffer)).toBe(
      "confirmed.png",
    );
    expect(upload.mock.calls[0][0]).toEqual(
      expect.stringMatching(/^\/api\/files\/xxh64:[0-9a-f]{16}$/),
    );
    expect(clipboard).toHaveBeenCalledTimes(1);
    expect(clipboard).toHaveBeenLastCalledWith(
      expect.stringContaining("![Confirmed description]"),
    );
  } finally {
    await view.unmount();
    upload.mockRestore();
    clipboard.mockRestore();
  }
});
