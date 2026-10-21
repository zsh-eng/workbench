// Applies the saved theme before the first paint, so a dark or warm theme
// never flashes white. src/settings.ts owns the settings; this reads two.
(() => {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem("arctic:settings") || "{}");
  } catch {}
  const appearance = saved.appearance || "system";
  const dark =
    appearance === "dark" ||
    (appearance === "system" &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = saved.theme || "arctic";
  document.documentElement.dataset.mode = dark ? "dark" : "light";
})();
