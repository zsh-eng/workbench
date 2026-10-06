/** Loopback-only benchmark, read-only source, aggregate results only. */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { loadavg } from "node:os";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import type { StoredOperation } from "../../src/lib/sync/records";
import type { RawRecord, BrowserSample } from "./types";
import { syncTables } from "../../src/lib/sync/records";
const port = 5399,
  origin = `http://127.0.0.1:${port}`;
const source = new Database("cutover.local/converted/backend.sqlite", {
  readonly: true,
});
const owner = (
  source
    .query(
      "SELECT user_id,count(*) n FROM sync_records GROUP BY user_id ORDER BY n DESC LIMIT 1",
    )
    .get() as { user_id: string }
).user_id;
const records = source
  .query(
    "SELECT key,value FROM sync_records WHERE user_id=? ORDER BY server_seq",
  )
  .all(owner) as RawRecord[];
source.close();
const decoded = records.map((r) => {
  const [table] = JSON.parse(r.key);
  return { table, row: syncTables[table].decode!(r.value) as StoredOperation };
});
const expected = Object.fromEntries(
  ["all", "main"].map((scope) => {
    const rows = decoded
      .filter((r) => scope === "all" || r.table === "operations")
      .sort((a, b) => {
        const x = a.table + "\0" + a.row.id,
          y = b.table + "\0" + b.row.id;
        return x < y ? -1 : x > y ? 1 : 0;
      });
    return [
      scope,
      {
        count: rows.length,
        hash: createHash("sha256")
          .update(
            rows
              .map((r) => r.table + "\t" + JSON.stringify(r.row) + "\n")
              .join(""),
          )
          .digest("hex"),
      },
    ];
  }),
);
const build = await Bun.build({
  entrypoints: ["scripts/storage-benchmark/opfs-worker.ts"],
  target: "browser",
  external: ["/sqlite/index.mjs"],
});
if (!build.success) throw Error(String(build.logs));
const dir = resolve("cutover.local/storage-benchmark");
await mkdir(dir, { recursive: true });
const resultPath = resolve(
  dir,
  `opfs-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
const samples: BrowserSample[] = [];
let claimed = false;
const metadata = {
  createdAt: new Date().toISOString(),
  records: records.length,
  mainRecords: expected.main.count,
  sqlitePackage: "3.53.4-build1",
  batch: 5000,
  fixture: "2026-09-19 converted snapshot, largest account",
  verification:
    "New worker after writer termination; all rows SHA-256; SQLite quick_check; temporary stores removed",
};
const page = `<!doctype html><title>Spaced OPFS benchmark</title><h1>Spaced OPFS comparison</h1><p>Local snapshot. Three engines, two datasets, three rounds. Click Start comparison once and keep this page open.</p><button id="run">Start comparison</button><pre id="status">Ready</pre><script type="module">
const status=document.querySelector('#status');
function job(c){return new Promise((resolve,reject)=>{const worker=new Worker('/worker.js',{type:'module'});const timer=setTimeout(()=>{worker.terminate();reject(Error('Worker timed out'));},180000);worker.onmessage=({data})=>{clearTimeout(timer);worker.terminate();data.ok?resolve(data):reject(Error(data.error));};worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(Error(e.message));};worker.postMessage(c);});}
document.querySelector('#run').onclick=async()=>{
 document.querySelector('#run').disabled=true;
 try{
 const claim=await fetch('/claim',{method:'POST'});if(!claim.ok)throw Error('This server run is already claimed; do not run duplicate heavy benchmarks.');
 await fetch('/progress',{method:'POST',body:'Preparing fresh benchmark origin'});
 const engines=['dexie','native-idb','opfs'];let n=0;const lines=[];
 for(let round=0;round<3;round++)for(const scope of round%2?['main','all']:['all','main'])for(const engine of [...engines.slice(round),...engines.slice(0,round)]){
  if((await (await fetch('/load')).json()).load[0]>20)throw Error('Host load too high');
  const c={engine,scope,batch:5000,name:'SpacedOPFSBench-'+crypto.randomUUID()};
  status.textContent=n+'/18 complete. Running '+engine+' '+scope+'…\\n'+lines.join('\\n');
  await fetch('/progress',{method:'POST',body:engine+' '+scope+' write'});
  const start=performance.now();const write=await job({...c,mode:'write'});
  await fetch('/progress',{method:'POST',body:engine+' '+scope+' verify in fresh worker'});
  const verify=await job({...c,mode:'verify'});
  const sample={...write,...verify,round:round+1,caseWallMs:performance.now()-start};delete sample.name;
  const saved=await fetch('/sample',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(sample)});if(!saved.ok)throw Error(await saved.text());
  lines.push(engine+' '+scope+': '+(write.writeMs/1000).toFixed(3)+' s — persisted and verified');n++;
 }
 status.textContent='Complete: 18/18 verified; temporary databases removed.\\n'+lines.join('\\n');await fetch('/complete',{method:'POST'});
}catch(e){status.textContent='Stopped: '+e;await fetch('/error',{method:'POST',body:String(e)});}
};
</script>`;
Bun.serve({
  hostname: "127.0.0.1",
  port,
  idleTimeout: 255,
  async fetch(req) {
    const u = new URL(req.url);
    if (
      u.origin !== origin ||
      (req.headers.get("origin") && req.headers.get("origin") !== origin)
    )
      return new Response("Forbidden", { status: 403 });
    if (u.pathname === "/")
      return new Response(page, {
        headers: { "content-type": "text/html", "Cache-Control": "no-store" },
      });
    if (u.pathname === "/worker.js")
      return new Response(build.outputs[0], {
        headers: { "content-type": "text/javascript" },
      });
    if (u.pathname.startsWith("/sqlite/")) {
      const name = u.pathname.slice(8);
      if (
        !["index.mjs", "sqlite3.wasm", "sqlite3-opfs-async-proxy.js"].includes(
          name,
        )
      )
        return new Response("Forbidden", { status: 403 });
      return new Response(
        Bun.file(resolve("node_modules/@sqlite.org/sqlite-wasm/dist", name)),
        {
          headers: {
            "content-type": name.endsWith(".wasm")
              ? "application/wasm"
              : "text/javascript",
          },
        },
      );
    }
    if (u.pathname === "/fixture") return Response.json({ records, expected });
    if (u.pathname === "/load") return Response.json({ load: loadavg() });
    if (u.pathname === "/claim" && req.method === "POST") {
      if (claimed) return new Response("Already running", { status: 409 });
      claimed = true;
      return new Response("OK");
    }
    if (u.pathname === "/sample" && req.method === "POST") {
      const sample = (await req.json()) as BrowserSample;
      if (!sample.verified || !sample.cleaned)
        return new Response("Not verified", { status: 400 });
      sample.hostLoad = loadavg();
      samples.push(sample);
      await Bun.write(
        resultPath,
        JSON.stringify({ metadata, samples }, null, 2),
      );
      console.log(
        samples.length +
          "/18 " +
          sample.engine +
          " " +
          sample.scope +
          " " +
          (sample.writeMs / 1000).toFixed(3) +
          "s persisted, verified, cleaned",
      );
      return new Response("OK");
    }
    if (u.pathname === "/progress" && req.method === "POST") {
      console.log("PROGRESS " + (await req.text()));
      return new Response("OK");
    }
    if (u.pathname === "/complete" && req.method === "POST") {
      console.log("COMPLETE " + resultPath);
      return new Response("OK");
    }
    if (u.pathname === "/error" && req.method === "POST") {
      console.error("BROWSER ERROR " + (await req.text()));
      return new Response("OK");
    }
    return new Response("Not found", { status: 404 });
  },
});
console.log("Ready " + origin + " PID " + process.pid);
