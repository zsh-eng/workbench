// The `hyphen` package ships no types for the files Reader imports directly.
declare module "hyphen/hyphen.js" {
  interface HyphenatorOptions {
    html: boolean;
    hyphenChar: string;
    minWordLength: number;
  }
  export default function createHyphenator(
    patterns: unknown,
    options: HyphenatorOptions,
  ): (text: string) => string;
}

declare module "hyphen/patterns/*" {
  const patterns: unknown;
  export default patterns;
}
