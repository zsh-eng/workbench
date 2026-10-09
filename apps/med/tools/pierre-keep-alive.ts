import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

/**
 * Keeps Pierre's CodeView mounted while it is hidden. Version-checked, like the
 * highlighter patch.
 *
 * A hidden React `<Activity>` detaches refs but keeps the elements. Pierre's
 * React wrapper destroyed its CodeView when the ref detached, so each
 * workspace switch built the shown review's diffs again, with a forced layout.
 * The wrapper now keeps the view while its element stays in the document and
 * frees it when React removes the element.
 *
 * A view with `display: none` has no box. Pierre measured it as zero height
 * and replaced the rendered rows; it now skips that work until the view has a
 * box again, and its resize observer reports the size.
 */
export function pierreKeepAlive(): Plugin {
  function replace(source: string, from: string, to: string) {
    if (!source.includes(from))
      throw new Error(`Pierre CodeView changed; missing ${from.slice(0, 70)}`);
    return source.replace(from, to);
  }
  return {
    name: "med-pierre-keep-alive",
    enforce: "pre",
    buildStart() {
      const pkg = JSON.parse(
        readFileSync(new URL("../package.json", import.meta.resolve("@pierre/diffs")), "utf8"),
      );
      if (pkg.version !== "1.4.3")
        throw new Error("Re-audit the CodeView keep-alive patch before upgrading Pierre 1.4.3");
    },
    transform(source, id) {
      const path = id.split("?")[0]!;
      if (path.endsWith("/@pierre/diffs/dist/react/CodeView.js")) {
        source = replace(
          source,
          "function CodeViewInner(props, ref) {",
          `const detachedViews = new Map();
let detachedSweep;
function sweepDetachedViews() {
	detachedSweep = void 0;
	for (const [view, cleanUp] of detachedViews) if (!view.getContainerElement()?.isConnected) {
		detachedViews.delete(view);
		cleanUp();
	}
	if (detachedViews.size > 0) detachedSweep = setTimeout(sweepDetachedViews, 1e4);
}
function keepWhileConnected(view, cleanUp) {
	detachedViews.set(view, cleanUp);
	queueMicrotask(() => {
		if (detachedViews.get(view) !== cleanUp) return;
		if (view.getContainerElement()?.isConnected) detachedSweep ??= setTimeout(sweepDetachedViews, 1e4);
		else {
			detachedViews.delete(view);
			cleanUp();
		}
	});
}
function CodeViewInner(props, ref) {`,
        );
        return replace(
          source,
          "\tconst nodeRef = useStableCallback((node) => {\n",
          `\tconst nodeRef = useStableCallback((node) => {
		const kept = cachedDataRef.current.instance;
		if (kept != null && node == null) {
			keepWhileConnected(kept, () => {
				if (cachedDataRef.current.instance !== kept) return;
				kept.cleanUp();
				slotContentStore.publish(void 0);
				cachedDataRef.current = createDefaultCache(controlled);
			});
			assignRef(containerRef, node);
			return;
		}
		if (kept != null && node === kept.getContainerElement()) {
			detachedViews.delete(kept);
			kept.render();
			assignRef(containerRef, node);
			return;
		}
`,
        );
      }
      if (path.endsWith("/@pierre/diffs/dist/components/CodeView.js")) {
        source = replace(
          source,
          "\thandleResize = (entries) => {\n",
          `\thandleResize = (entries) => {
		if (this.root != null && this.root.getClientRects().length === 0) {
			this.scrollDirty = true;
			this.heightDirty = true;
			return;
		}
`,
        );
        return replace(
          source,
          "\t\tif (CodeView.__STOP || this.container == null) return;\n\t\tif (!this.isReady()) return;",
          "\t\tif (CodeView.__STOP || this.container == null) return;\n\t\tif (this.root != null && this.root.getClientRects().length === 0) return;\n\t\tif (!this.isReady()) return;",
        );
      }
    },
  };
}
