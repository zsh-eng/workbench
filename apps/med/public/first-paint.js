// The theme's frame color for the first frame, before the app loads
// (themes.ts). A file of its own, not inline, so the host's script-src 'self'
// lets it run.
try {
  // With nothing chosen: System, between Pierre Light and Pierre Dark.
  const paint = JSON.parse(localStorage.getItem("med:theme-paint") ?? "null") ?? {
    mode: "system",
    light: "#f5f5f5",
    dark: "#171717",
  };
  const dark =
    paint.mode === "dark" ||
    (paint.mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.style.colorScheme = dark ? "dark" : "light";
  root.style.backgroundColor = dark ? paint.dark : paint.light;
} catch {}
