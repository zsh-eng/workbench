// Pierre Words, as Med builds it: a Markdown renderer in WebAssembly, with
// Med's patch that places its HTML in the source (upstream/PIERRE-WORDS.md).
// Med calls the module as Words' own core does, through the bytes at the
// start of its memory, for the options that the patch adds.
import words from "./words-wasm";

const PAGE = 65536;
/** `$mem.input` in Words' memory.wat: the input follows four pages of tables. */
const INPUT_AT = 4 * PAGE;
/** Words reads up to 32 bytes past the input: a NUL, then room for its vector scans. */
const SLACK = 32;

interface Module {
  memory: WebAssembly.Memory;
  render(): void;
}
let module: Module | undefined;

function load(): Module {
  if (module) return module;
  const bytes = Uint8Array.from(atob(words), (c) => c.charCodeAt(0));
  const exports = new WebAssembly.Instance(new WebAssembly.Module(bytes), {})
    .exports as unknown as {
    memory: WebAssembly.Memory;
    render(): void;
    seed(seed: number): void;
  };
  // A random seed, so that crafted reference labels cannot share a slot.
  exports.seed((Math.random() * 2 ** 32) >>> 0);
  return (module = { memory: exports.memory, render: exports.render });
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface WordsOptions {
  /** A single `$` starts math too, as in files; replies read only `$$` as math. */
  singleDollarMath?: boolean;
  /**
   * The source option of Med's patch: each top-level block ends with a NUL,
   * its first and last lines as "first,last", and a NUL; headings, code
   * blocks, and tables name their lines; raw HTML, a block or a tag, is
   * escaped text in a `<template data-html>`. Without it, a summary renders
   * as plain HTML.
   */
  sourceLines?: boolean;
}

/**
 * GitHub's Markdown as HTML, with math as TeX for KaTeX, and raw HTML as
 * escaped text that renders nothing (raw-html.ts).
 */
export function renderWords(
  text: string,
  { singleDollarMath = false, sourceLines = true }: WordsOptions = {},
) {
  const { memory, render } = load();
  const input = encoder.encode(text);
  const needed = INPUT_AT + input.length + SLACK + 8192;
  if (needed > memory.buffer.byteLength)
    memory.grow(Math.ceil((needed - memory.buffer.byteLength) / PAGE));
  const bytes = new Uint8Array(memory.buffer);
  bytes.set(input, INPUT_AT);
  bytes.fill(0, INPUT_AT + input.length, INPUT_AT + input.length + SLACK);
  const view = new DataView(memory.buffer);
  view.setUint8(0, 0); // HTML, not the terminal's text
  view.setUint8(1, 2); // no raw HTML
  view.setUint32(2, input.length, true);
  view.setUint32(22, 0, true); // no wrap width
  view.setUint16(26, 0, true); // plain HTML, not Words' formatted tags
  // Extensions: 2 math, 4 source lines, 8 only `$$` starts inline math,
  // 16 math as TeX for KaTeX.
  view.setUint8(31, 2 | (sourceLines ? 4 : 0) | (singleDollarMath ? 0 : 8) | 16);
  render();
  // Rendering can grow the memory, which detaches the views above.
  const out = new DataView(memory.buffer);
  return decoder.decode(
    new Uint8Array(memory.buffer, out.getUint32(6, true), out.getUint32(10, true)),
  );
}
