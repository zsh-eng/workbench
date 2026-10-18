import type {
  SearchWorkerRequest,
  SearchWorkerResponse,
} from "./search-protocol";
import { createSearchHandler } from "./search-handler";

/** Searches a book's chapter text off the main thread. */
const handle = createSearchHandler((response: SearchWorkerResponse) =>
  postMessage(response),
);
onmessage = (event: MessageEvent<SearchWorkerRequest>) => handle(event.data);
