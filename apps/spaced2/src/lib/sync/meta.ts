import { db } from "@/lib/db/persistence";

export async function setClientId(clientId: string): Promise<void> {
  await db.metadataKv.put({ key: "clientId", value: clientId });
}

export async function getClientId(): Promise<string | null> {
  const clientId = await db.metadataKv.get("clientId");
  if (!clientId) {
    return null;
  }

  return clientId.value as string;
}
