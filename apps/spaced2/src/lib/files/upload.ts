import { requestSharedFile } from "./shared-request";
import xxhash from "xxhash-wasm";
import { API_BASE, SHARED_API_ORIGIN } from "../api";
export type UploadResponse =
  | { success: true; fileKey: string }
  | { success: false; error: string };
let hasher: ReturnType<typeof xxhash> | undefined;
export async function uploadImage(image: File): Promise<UploadResponse> {
  const bytes = await image.arrayBuffer();
  hasher ??= xxhash();
  const id = `xxh64:${(await hasher).h64Raw(new Uint8Array(bytes)).toString(16).padStart(16, "0")}`;
  const send = SHARED_API_ORIGIN
    ? (url: string, init: RequestInit) =>
        requestSharedFile(url.slice(API_BASE.length), init)
    : fetch;
  const response = await send(`${API_BASE}/files/${id}`, {
    method: "PUT",
    body: bytes,
    headers: { "Content-Type": image.type || "application/octet-stream" },
    credentials: "include",
  });
  if (!response.ok) return { success: false, error: "Failed to upload image" };
  return { success: true, fileKey: id };
}
export function constructImageMarkdownLink(fileKey: string, altText?: string) {
  return `![${altText || "Image"}](${API_BASE}/files/${fileKey})`;
}
