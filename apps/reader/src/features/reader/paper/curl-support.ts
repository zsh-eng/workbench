let support: boolean | null = null;

/**
 * Whether this browser can draw the curl; checked once. Kept apart from the
 * curl itself, so the Reader can decide without loading it.
 */
export function isPageCurlSupported(): boolean {
  if (support !== null) return support;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl");
    support = Boolean(gl);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    support = false;
  }
  return support;
}
