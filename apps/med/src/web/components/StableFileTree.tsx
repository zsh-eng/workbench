import { FileTree, type FileTreeOptions } from "@pierre/trees";
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DetailedHTMLProps,
  type HTMLAttributes,
} from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "file-tree-container": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

// The element each tree is rendered into.
const hosts = new WeakMap<FileTree, HTMLElement>();

/**
 * Pierre's useFileTree destroys its model 1 ms after its effect cleanup. A
 * hidden workspace runs that cleanup too, so a workspace shown again had a
 * tree whose folders did not open and whose selection did not report. This
 * model lives as long as its component. It holds no global listeners, so
 * garbage collection frees it.
 */
export function useStableFileTree(options: FileTreeOptions) {
  const [model] = useState(() => new FileTree(options));
  return model;
}

/**
 * Pierre's React FileTree renders its tree in a layout effect and removes it in
 * that effect's cleanup. A hidden workspace runs effect cleanups too, so each
 * workspace switch removed and rebuilt every tree, and measured it, before the
 * frame could paint. This host renders a tree once and keeps it while its
 * element stays in the document: hiding keeps the element, unmounting does not.
 */
export function StableFileTree({
  model,
  style,
  ...props
}: { model: FileTree } & Omit<HTMLAttributes<HTMLElement>, "children">) {
  const host = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const node = host.current!;
    if (hosts.get(model) !== node) {
      if (hosts.has(model)) model.unmount();
      model.render({ fileTreeContainer: node });
      hosts.set(model, node);
    }
    return () => {
      // React removes an unmounted element after this cleanup runs.
      queueMicrotask(() => {
        if (node.isConnected || hosts.get(model) !== node) return;
        hosts.delete(model);
        model.unmount();
      });
    };
  }, [model]);
  return (
    <file-tree-container
      {...props}
      ref={host}
      style={
        {
          "--trees-item-height": `${model.getItemHeight()}px`,
          "--trees-density-override": model.getDensityFactor(),
          ...style,
        } as CSSProperties
      }
    />
  );
}
