# @workbench/file-batch

Many small files in one response: the shared API's
`POST /api/apps/<namespace>/files/batch` (`apps/sync-server/src/files.ts`) and
the browser side that reads it. Arctic for the web downloads article text with
it, and Spaced its card images. Why, and the measurements:
[Bulk file downloads](../../docs/FILE_BATCH.md). The package exports
TypeScript source and has no dependencies.

| Export              | What it is                                                        |
| ------------------- | ----------------------------------------------------------------- |
| `downloadFiles`     | Downloads ids in batches, several at once; stores each on arrival |
| `readFileBatch`     | Reads a batch body, file by file                                  |
| `encodeFrameHeader` | The worker's header line for one file, or the end                 |
| `parseBatchRequest` | The ids of a request body, or null                                |

## Request

`{"ids": ["xxh64:…", …]}`: 1 to 32 file IDs, as JSON. The usual session or
Workbench Backup credential and `X-Sync-Scope` apply. Only `spaced` and
`arctic-content` offer the route; another namespace answers 404, and a server
without the route answers 400 (it reads `batch` as a file ID).

## Response

`Content-Type: application/x-workbench-file-batch`, gzip-encoded for text when
the client accepts it. A sequence of frames: a JSON header line, then, for a
200, exactly `size` bytes of the file.

```text
{"id":"xxh64:…","status":200,"size":1234,"type":"image/png"}\n<1234 bytes>
{"id":"xxh64:…","status":404}\n
{"id":"xxh64:…","status":500}\n
{"end":true}\n
```

- **404**: no such file in this account and namespace, or a deleted one.
- **500**: storage failed to read it; ask again.
- **Left out**: the server stops adding files at 1 MiB of file bytes (always
  sending one), so that a response ends well inside a client's 30-second
  request timeout. Ask again for ids that a complete answer left out.
- **No end frame**: the connection dropped. Files read so far are complete;
  ask again for the rest.

## Downloading

```ts
await downloadFiles({
  ids,
  fetchBatch: (ids, signal) => request("/files/batch", …), // any status
  fetchOne: (id, signal) => request(`/files/${id}`, …), // any status
  store: async (id, bytes, type) => save(id, bytes, type),
  onFailed: (id, error) => count(id),
  signal,
});
```

Six requests run at once. A file gets three tries, with backoff after a
failed request. 404 fails a file at once. 401, 403, 409, an abort and a full
disk (`QuotaExceededError` from `store`) stop the download and reject. A
server that answers 400, 404, 405 or 501 to the batch route gets one `GET`
per file instead. `test/download.test.ts` covers a dropped connection, a
slow link that cuts every answer short and a server that keeps failing; the
sync server's service test covers the route end to end, with the fallback for
a namespace without it.
