# @workbench/agent-kit

Screenshots, clips and timings of one page on a warm dev server, so that an
agent does not write a new browser script for each check. Each command has a
hard time cap, prints one or two lines, and gives the paths of its files.
Start the app's server first; for Reader, `E2E_PORT=<port> bun run e2e:serve`
in `apps/reader`.

```sh
bun run kit shot <url|/route> [--steps file]                 # PNG, 60 s cap
bun run kit clip <url|/route> [--steps file] [--sheet 6]     # MP4, 120 s cap
bun run kit time <url|/route> --steps file [--throttle 4]    # JSON, 180 s cap
```

A route such as `/settings` is served from `http://127.0.0.1:$E2E_PORT`.
The page is a phone, 390 × 844 at 2×, with touch and service workers blocked.
If the server answers `/__e2e`, the kit refuses a server from another checkout.

| Option                | Effect                                                          |
| --------------------- | --------------------------------------------------------------- |
| `--before <file>`     | Runs first, on a blank page. May return `{name}` values.        |
| `--storage key=value` | Sets `localStorage` before the app starts, e.g. Debug switches. |
| `--steps <file>`      | The interaction: before the shot, recorded, or timed.           |
| `--wait <selector>`   | Waits for a Playwright selector after the page loads.           |
| `--out <file>`        | Output path. The default is in the system temp folder.          |
| `--dark`, `--desktop` | Dark colour scheme; a 1280 × 800 window without touch.          |
| `--throttle <rate>`   | Makes the CPU that many times slower, after the page loads.     |
| `--seconds <n>`       | `clip` without steps: how long to record (3).                   |
| `--sheet <n>`         | `clip`: also writes n frames side by side as a PNG.             |
| `--runs`, `--warmup`  | `time`: timed runs (10) after untimed runs (1).                 |
| `--full`, `--timeout` | `shot`: the full page. The time cap in seconds.                 |

A module's default export receives `{ page, context, baseURL, vars }`. For
`time`, it is one run: it can return its own duration in milliseconds, for
example one measured in the page; otherwise the kit times the call. An
optional `reset` export runs, untimed, after each run. The kit prints the
median, the p95 and the load average, because results under load are slow.

`{name}` in the URL takes the value that a `--before` module returned. For
example, Reader's `test/e2e/kit/sample-book.ts` imports the sample book and
returns `{book}`:

```sh
cd apps/reader
bun run kit shot '/reader/{book}' --before test/e2e/kit/sample-book.ts
bun run kit time '/reader/{book}' --before test/e2e/kit/sample-book.ts \
  --steps test/e2e/kit/reader-tools.ts --throttle 4
```
