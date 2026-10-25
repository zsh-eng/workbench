/**
 * Writes plain text to the clipboard. Call it from the tap or click itself:
 * Safari, in the browser and in a Home Screen app, allows a write only
 * within the user's gesture, so nothing may be awaited before this call.
 *
 * The Clipboard API needs a secure context. Elsewhere, such as a page opened
 * over a LAN address, the text goes through a hidden text field and the
 * copy command instead.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  return copyWithCommand(text);
}

function copyWithCommand(text: string): boolean {
  const selection = window.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index),
      )
    : [];
  const focused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const field = document.createElement("textarea");
  field.value = text;
  // Read-only keeps the keyboard closed; 16px stops iOS zooming to it; a
  // fixed, transparent field keeps the page from scrolling to it.
  field.readOnly = true;
  field.setAttribute("aria-hidden", "true");
  field.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;pointer-events:none";
  document.body.appendChild(field);
  field.focus({ preventScroll: true });
  field.setSelectionRange(0, text.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  field.remove();
  focused?.focus({ preventScroll: true });
  // Give back a passage selection the reader still has tools open for.
  if (selection) {
    selection.removeAllRanges();
    for (const range of ranges) selection.addRange(range);
  }
  return copied;
}
