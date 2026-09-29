# macOS releases

Build on Apple Silicon with Bun 1.3.5 and a clean checkout. Install dependencies
with `bun install --frozen-lockfile` from the Workbench root. Keep the release
version in `package.json` and `docs/INSTALL.md` aligned. The runtime notices in
`upstream/BUN-LICENSE.md` come from `oven-sh/bun` at `bun-v1.3.5`; update them if
changing the runtime.

From `apps/med`:

```sh
bun scripts/release-macos.ts /tmp/med-release
MED_EXECUTABLE=/tmp/med-release/med-v0.1.3-macos-arm64/med node scripts/validate-media.mjs
MED_EXECUTABLE=/tmp/med-release/med-v0.1.3-macos-arm64/med node scripts/validate-service.mjs
MED_EXECUTABLE=/tmp/med-release/med-v0.1.3-macos-arm64/med node scripts/validate-markdown-links.mjs
MED_EXECUTABLE=/tmp/med-release/med-v0.1.3-macos-arm64/med node scripts/validate-review-links.mjs
```

The script checks types, builds the UI, compiles the executable, checks its
version and embedded docs, applies and verifies an ad-hoc signature, collects
dependency notices, and writes the tarball,
build metadata, and SHA-256 checksum. It refuses a dirty checkout or an existing
staging directory. The service test starts the executable outside the checkout,
uses temporary repositories and a synthetic vault, and closes its own processes.
Also run `bun run lint` and `node scripts/validate-markdown.mjs` before publication.

Inspect the archive and `BUILD.json`. Verify `codesign --verify med` and the
minimum macOS version with `otool -l med`. The script replaces Bun's linker signature
after compilation with a verified ad-hoc signature. It is not Developer ID signed or notarized. Do not describe it as such.

Publish only when authorized. Use Med-specific tags (`med-v0.1.3`) because this
repository also releases other apps. Tag the exact `BUILD.json` commit, push the
tag without force, and attach the tarball and `SHA256SUMS` to a GitHub release.
Set `--latest=false` so a Med release does not replace another app's latest marker.
Download the published assets and verify their checksum once more. Never include
personal state, real vault contents, authentication tokens, or benchmark copies.
