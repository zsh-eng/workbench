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
  const consume = (text: string) => {
    for (const character of text) {
      if (previousCR && character === "\n") {
        previousCR = false;
        continue;
      }
      previousCR = false;
      if (character === "\r" || character === "\n") {
        flushLine();
        previousCR = character === "\r";
      } else {
        line += character;
        eventSize += character.length;
        if (eventSize > maxEventSize) throw new Error("The server sent an invalid event size.");
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
