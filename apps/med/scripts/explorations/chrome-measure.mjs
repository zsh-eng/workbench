// The chrome's measure, for measure-chrome.mjs and scene 06. A control is a
// visible button, tab, link, select, or text field in the title band, a pane's
// header rows, or the status bar: not the sidebar, a file's own header, the
// session's thread, or its message box.

/** Runs in the page: the first diff line and the chrome's controls. */
export function measure() {
  const visible = (element) => {
    const box = element.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return null;
    if (box.bottom <= 0 || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth)
      return null;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || Number(style.opacity) === 0) return null;
    return box;
  };
  const deep = (root, selector, found = []) => {
    for (const element of root.querySelectorAll(selector)) found.push(element);
    for (const element of root.querySelectorAll("*"))
      if (element.shadowRoot) deep(element.shadowRoot, selector, found);
    return found;
  };
  const review = [...document.querySelectorAll('[data-pane="review"]')].find((pane) =>
    visible(pane),
  );
  const lines = review
    ? deep(review, "[data-line]")
        .map((line) => visible(line))
        .filter(Boolean)
        .map((box) => box.top)
    : [];
  const firstLine = lines.length ? Math.round(Math.min(...lines)) : null;
  const firstFile = review
    ? deep(review, "[data-stream-file]")
        .map((header) => visible(header))
        .filter(Boolean)
        .map((box) => box.top)
    : [];
  const interactive =
    "button, a[href], select, input:not([type=hidden]), textarea, [role=tab], [role=button], [role=combobox], [role=checkbox], [role=switch]";
  const controls = [];
  for (const element of document.querySelectorAll(interactive)) {
    if (element.closest('aside, #xp-root, [aria-hidden="true"]')) continue;
    // A control inside another control counts once.
    if (element.parentElement?.closest(interactive)) continue;
    const box = visible(element);
    if (!box) continue;
    const pane = element.closest("[data-pane]");
    const band = element.closest('header[aria-label="Workspace"]');
    const status = element.closest("footer");
    let place = band ? "band" : status ? "status" : null;
    if (!place && pane) {
      const id = pane.dataset.pane;
      if (id === "review") {
        // Rows above the stream; the stream's own file headers are content.
        const limit = firstFile.length ? Math.min(...firstFile) : (firstLine ?? innerHeight);
        if (box.top < limit - 2 && !element.closest('nav[aria-label="Files and commits"]'))
          place = "review";
      } else if (element.closest("header, [data-pane-handle]")) place = id;
    }
    if (!place) continue;
    const label =
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      element.textContent?.trim().replace(/\s+/g, " ").slice(0, 40) ||
      element.outerHTML.slice(0, 120);
    controls.push({ place, label, top: Math.round(box.top), left: Math.round(box.left) });
  }
  controls.sort((a, b) => a.top - b.top || a.left - b.left);
  return {
    firstLine,
    firstFile: firstFile.length ? Math.round(Math.min(...firstFile)) : null,
    controls,
  };
}
