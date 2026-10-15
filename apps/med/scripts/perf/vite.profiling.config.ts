// The web build for the budget's React pass: React DOM's profiling renderer,
// which logs each render and phase to the performance timeline, and readable
// component names. budget.mjs gives the output folder with --outDir.
import base from "../../vite.config.ts";

export default {
  ...base,
  resolve: {
    ...base.resolve,
    alias: { ...base.resolve?.alias, "react-dom/client": "react-dom/profiling" },
  },
  build: { ...base.build, minify: false, sourcemap: false },
  logLevel: "warn",
};
