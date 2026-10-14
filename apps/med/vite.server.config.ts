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
    ssr: "src/cli/index.ts",
    outDir: "dist",
    emptyOutDir: false,
    target: "node22",
    sourcemap: true,
    // Bun's own `ws` module, imported only under Bun.
    rolldownOptions: { external: ["ws"], output: { entryFileNames: "cli.js" } },
  },
});
