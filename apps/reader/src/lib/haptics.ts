/**
 * A light tick for a detent under the finger. Android has the Vibration
 * API. iOS has none, but Safari plays its own tick when a switch toggles,
 * so a hidden switch is toggled instead. Either may stay silent: the
 * device can have haptics off, and iOS may play it only within a tap.
 */
export function hapticTick(): void {
  try {
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(8);
      return;
    }
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    label.appendChild(input);
    label.ariaHidden = "true";
    label.style.display = "none";
    // The clicks are for Safari's tick; no listener in the page needs them.
    label.addEventListener("click", (event) => event.stopPropagation());
    document.head.appendChild(label);
    label.click();
    label.remove();
  } catch {
    // A tick is a courtesy; the scrub works without it.
  }
}
