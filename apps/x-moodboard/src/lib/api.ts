import type { ItemDetail, LibraryProjection, UserEdit, UserState, VersionInfo } from "../../shared/schema";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new HttpError(0, "The local library server is not reachable.");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new HttpError(response.status, body?.error ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export const fetchLibrary = (signal?: AbortSignal) => request<LibraryProjection>("/api/library", { signal });
export const fetchVersion = () => request<VersionInfo>("/api/version", { cache: "no-store" });
export const fetchDetail = (id: string, signal?: AbortSignal) => request<ItemDetail>(`/api/items/${id}`, { signal });
export const fetchInfo = () => request<Record<string, unknown>>("/api/info");
export const fetchUserState = () => request<UserState>("/api/user-state", { cache: "no-store" });

export const putFavourite = (postId: string, on: boolean) =>
  request<UserState>(`/api/user-state/favourites/${postId}`, { method: on ? "PUT" : "DELETE" });

export const putEdit = (postId: string, edit: Omit<UserEdit, "editedAt"> | null) =>
  request<UserState>(`/api/user-state/edits/${postId}`, {
    method: edit ? "PUT" : "DELETE",
    headers: edit ? { "content-type": "application/json" } : undefined,
    body: edit ? JSON.stringify(edit) : undefined,
  });
