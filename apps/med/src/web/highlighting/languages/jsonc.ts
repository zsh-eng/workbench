import { createJsonScanner } from "./json";
const scan = createJsonScanner("json.comments");
export const tokenize = (_options?: { fidelity?: string }) => scan;
