import { db } from "@/lib/db/persistence";

export async function getSeqNo(): Promise<number> {
  const seqNo = await db.metadataKv.get("seqNo");
  if (!seqNo) {
    await db.metadataKv.put({ key: "seqNo", value: 0 });
    return 0;
  }

  if (typeof seqNo.value !== "number") {
    throw new Error("seqNo is not a number");
  }

  return seqNo.value as number;
}

export async function setSeqNo(seqNo: number) {
  await db.metadataKv.put({ key: "seqNo", value: seqNo });
}

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
