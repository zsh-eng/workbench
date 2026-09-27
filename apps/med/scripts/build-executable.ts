import { mkdtemp, readdir, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, relative } from "node:path";
const root = resolve(import.meta.dir, "..");
const output = resolve(process.argv[2] ?? join(root, "dist", "med"));
const temporary = await mkdtemp(join(tmpdir(), "med-build-"));
try {
  const web = join(root, "dist", "web");
  const files = (await readdir(web, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile() && !e.name.endsWith(".map"))
    .map((e) => join(e.parentPath, e.name));
  const imports = files.map(
    (file, i) => `import asset${i} from ${JSON.stringify(file)} with {type:"file"};`,
  );
  const map = files.map(
    (file, i) => `${JSON.stringify("/" + relative(web, file).split("\\").join("/"))}:asset${i}`,
  );
  const entry = join(temporary, "entry.ts");
  await writeFile(
    entry,
    `${imports.join("\n")}\nconst assets:Record<string,string>={${map.join(",")}};\n(globalThis as any).__medAssets=async(path:string)=>assets[path]?Bun.file(assets[path]).bytes():undefined;\nawait import(${JSON.stringify(join(root, "src", "cli", "index.ts"))});\n`,
  );
  await mkdir(resolve(output, ".."), { recursive: true });
  const build = await Bun.build({
    entrypoints: [entry],
    compile: { outfile: output },
    target: "bun",
  });
  if (!build.success) throw new Error(build.logs.join("\n"));
  console.log(`Built ${output} with ${files.length} web assets and embedded CLI documentation.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
