import { loadTheme, tokenLines, type SyntaxThemeData } from "./highlighter";

let latest: { id: number; text: string; language: string; theme: SyntaxThemeData } | undefined;
let running = false;
self.onmessage = (event: MessageEvent<NonNullable<typeof latest>>) => {
  latest = event.data;
  if (!running) void drain();
};
async function drain() {
  running = true;
  while (latest) {
    const task = latest;
    latest = undefined;
    try {
      loadTheme(task.theme);
      const lines = await tokenLines(task.text, task.language, task.theme.name!);
      // Newer input overtook this one while the highlighter loaded.
      if (latest) continue;
      const styles: string[] = [];
      const indices = new Map<string, number>();
      const ranges: number[] = [];
      let lineStart = 0;
      const text = task.text;
      // A line's tokens spell the line, so each token starts where the one
      // before it ended, whatever the highlighter counts its offsets from.
      for (const line of lines) {
        let start = lineStart;
        for (const token of line) {
          const length = token.content.length;
          if (!length) continue;
          let index = indices.get(token.style);
          if (index === undefined) {
            index = styles.length;
            styles.push(token.style);
            indices.set(token.style, index);
          }
          ranges.push(start, start + length, index);
          start += length;
        }
        const lf = text.indexOf("\n", start);
        lineStart = lf < 0 ? text.length : lf + 1;
      }
      const packed = Uint32Array.from(ranges);
      self.postMessage({ id: task.id, styles, ranges: packed }, [packed.buffer]);
    } catch (error) {
      self.postMessage({
        id: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  running = false;
}
