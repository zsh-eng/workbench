import { expect, test } from "vitest";
import { breakPieces } from "../../src/web/markdown/breaks";

const cut = (text: string) => breakPieces(text).join("|");

test("a long word of a table cell breaks at its separators, and nowhere else", () => {
  expect(
    cut("./gradlew :telemetry:histogram-core-internal:test --tests 'ClassicBucketsTest'"),
  ).toBe("./gradlew :telemetry|:histogram-|core-|internal|:test --tests 'ClassicBucketsTest'");
  expect(cut("registry.timer(bucketName())")).toBe("registry|.timer(|bucketName())");
  // A file's extension stays with its name, also before a line or an anchor.
  expect(cut("src/web/App.tsx:5158")).toBe("src/|web/|App.tsx|:5158");
  expect(cut("review-output.ts#L534")).toBe("review-|output.ts#L534");
  expect(cut("test/metrics.test.ts")).toBe("test/|metrics|.test.ts");
  expect(cut("pkg/__init__.py")).toBe("pkg/|__init__.py");
  // A URL keeps its scheme, and numbers and dates stay whole.
  expect(cut("https://example.com/docs/page")).toBe("https://|example.com/|docs/|page");
  expect(cut("1,234,567,890.50 at 2026-10-29T12:30:45Z")).toBe(
    "1,234,567,890.50 at 2026-10-29T12:30:45Z",
  );
  // Short words and words without separators stay as they are.
  expect(cut("bun run lint")).toBe("bun run lint");
  expect(cut("BucketBoundaryTest")).toBe("BucketBoundaryTest");
  // The pieces join into the text as it was, spaces and all.
  const text = "  a\tsrc/web/components/session/thread-heights.ts  and more\n";
  expect(breakPieces(text).join("")).toBe(text);
});
