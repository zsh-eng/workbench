import { defineConfig } from "vite";
import { readFile } from "node:fs/promises";
export default defineConfig({
  publicDir: false,
  plugins: [
    {
      name: "med-cli-docs",
      async load(id) {
        if (id.endsWith(".md"))
          return `export default ${JSON.stringify(await readFile(id, "utf8"))};`;
      },
    },
  ],
  build: {
    ssr: true,
    outDir: "dist",
    emptyOutDir: false,
    target: "node22",
    sourcemap: true,
    rolldownOptions: {
      // The CLI, the small process that keeps an agent (holder.ts), and the
      // bridge that runs Pi as an ACP agent (pi-acp.ts).
      input: {
        cli: "src/cli/index.ts",
        holder: "src/host/holder.ts",
        "pi-acp": "src/host/pi-acp.ts",
      },
      // Bun's own `ws` module, imported only under Bun.
      external: ["ws"],
      output: { entryFileNames: "[name].js" },
    },
  },
});
