#!/usr/bin/env python3
"""Copy visible vault files to a private directory outside source control."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

source = Path(sys.argv[1]).resolve(strict=True)
if not source.is_dir():
    raise SystemExit("Choose a vault directory.")
root = Path(tempfile.mkdtemp(prefix="med-vault-benchmark-"))
if subprocess.run(["git", "-C", str(root), "rev-parse", "--show-toplevel"],
                  capture_output=True).returncode == 0:
    root.rmdir()
    raise SystemExit("Temporary directory must be outside Git repositories.")
vault = root / "vault"
vault.mkdir(mode=0o700)
start = time.perf_counter()
count = size = 0
for directory, folders, files in os.walk(source, followlinks=False):
    folders[:] = [name for name in folders if not name.startswith(".")
                  and name not in ("node_modules", "__pycache__", "venv")
                  and not (Path(directory) / name).is_symlink()]
    target = vault / Path(directory).relative_to(source)
    target.mkdir(parents=True, exist_ok=True)
    for name in files:
        path = Path(directory) / name
        if name.startswith(".") or path.is_symlink() or not path.is_file():
            continue
        shutil.copy2(path, target / name)
        count += 1
        size += (target / name).stat().st_size
manifest = dict(root=str(root), vault=str(vault), files=count, bytes=size,
                copy_seconds=time.perf_counter() - start,
                exclusions=["dotfiles and hidden directories", "node_modules",
                            "__pycache__", "venv", "symlinks"])
(root / "copy-manifest.json").write_text(json.dumps(manifest, indent=2))
print(json.dumps(manifest, indent=2))
