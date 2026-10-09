// Install tabs (WAI-ARIA tabs with automatic activation) and copy buttons.

const tabs = [...document.querySelectorAll('[role="tab"]')];

function select(tab, focus) {
  for (const other of tabs) {
    const selected = other === tab;
    other.setAttribute("aria-selected", String(selected));
    other.tabIndex = selected ? 0 : -1;
    document.getElementById(other.getAttribute("aria-controls")).hidden =
      !selected;
  }
  if (focus) tab.focus();
}

const keys = { ArrowLeft: -1, ArrowRight: 1 };
for (const tab of tabs) {
  tab.addEventListener("click", () => select(tab, false));
  tab.addEventListener("keydown", (event) => {
    const index = tabs.indexOf(tab);
    let next;
    if (event.key in keys) next = index + keys[event.key];
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    select(tabs[(next + tabs.length) % tabs.length], true);
  });
}

const status = document.getElementById("copy-status");

for (const button of document.querySelectorAll("[data-copy]")) {
  const label = button.querySelector(".copy-label");
  const source = document.getElementById(button.dataset.copy);
  let timer;
  button.addEventListener("click", async () => {
    clearTimeout(timer);
    try {
      await navigator.clipboard.writeText(source.textContent);
      label.textContent = "Copied";
      button.dataset.state = "done";
      status.textContent = button.dataset.done;
    } catch {
      // Select the text, so the reader can copy it with the keyboard.
      getSelection().selectAllChildren(source);
      status.textContent = "Copy is not available. The text is selected.";
    }
    timer = setTimeout(() => {
      label.textContent = "Copy";
      delete button.dataset.state;
      // An empty region lets the next copy announce again.
      status.textContent = "";
    }, 2000);
  });
}
