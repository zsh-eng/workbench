export interface ServerEvent {
  event: string;
  data: string;
  id?: string;
}

/** Incremental SSE parser. Chunks may split lines, CRLF pairs, or UTF-8 characters. */
export async function readServerEvents(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: ServerEvent) => void,
  signal?: AbortSignal,
  /** Session streams carry tool output and diffs; other streams keep the 64 KiB bound. */
  maxEventSize = 65_536,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let line = "";
  let previousCR = false;
  let event = "message";
  let id: string | undefined;
  let data: string[] = [];
  let eventSize = 0;
  const flushLine = () => {
    if (!line) {
      if (data.length)
        onEvent({ event, data: data.join("\n"), ...(id === undefined ? {} : { id }) });
      event = "message";
      data = [];
      eventSize = 0;
    } else if (!line.startsWith(":")) {
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "data") data.push(value);
      else if (field === "event") event = value;
      else if (field === "id" && !value.includes("\0")) id = value;
    }
    line = "";
  };
  const append = (part: string) => {
    eventSize += part.length;
    if (eventSize > maxEventSize) throw new Error("The server sent an invalid event size.");
    line += part;
  };
  // A session's first event can be megabytes: find line ends with indexOf,
  // not one character at a time.
  const consume = (text: string) => {
    if (!text) return;
    let start = previousCR && text[0] === "\n" ? 1 : 0;
    previousCR = false;
    let lf = text.indexOf("\n", start);
    let cr = text.indexOf("\r", start);
    while (start < text.length) {
      if (lf >= 0 && lf < start) lf = text.indexOf("\n", start);
      if (cr >= 0 && cr < start) cr = text.indexOf("\r", start);
      const end = lf < 0 ? cr : cr < 0 ? lf : Math.min(lf, cr);
      if (end < 0) {
        append(text.slice(start));
        return;
      }
      append(text.slice(start, end));
      flushLine();
      start = end + 1;
      if (end === cr) {
        if (start === text.length) previousCR = true;
        else if (text[start] === "\n") start++;
      }
    }
  };
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (!signal?.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      consume(decoder.decode(chunk.value, { stream: true }));
    }
    consume(decoder.decode());
    // SSE requires a blank line to dispatch an event. An incomplete final frame is discarded.
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
