import { constructImageMarkdownLink, uploadImage } from "@/lib/files/upload";

// Retain the user's stored IDs while the deck query loads. Only use IDs that
// are present in the current query result for a new import.
export function availableDeckIds(selected: string[], decks: { id: string }[]) {
  const available = new Set(decks.map((deck) => deck.id));
  return selected.filter((id) => available.has(id));
}

export function createAssetLinkResolver(upload = uploadImage) {
  const uploads = new Map<string, Promise<string>>();
  return async (path: string, file: () => File, alt?: string) => {
    let uploaded = uploads.get(path);
    if (!uploaded) {
      uploaded = upload(file()).then((response) => {
        if (!response.success) throw new Error(response.error);
        return response.fileKey;
      });
      uploads.set(path, uploaded);
    }
    return constructImageMarkdownLink(await uploaded, alt);
  };
}

export async function undoImportedCards(
  ids: string[],
  remove: (id: string) => Promise<unknown>,
) {
  const failedIds: string[] = [];
  for (const id of ids) {
    try {
      await remove(id);
    } catch (error) {
      console.error(error);
      failedIds.push(id);
    }
  }
  return { failedIds, undone: ids.length - failedIds.length };
}
