#!/usr/bin/env python3
"""Compile the production account-record sync and run its tests.

The highlights, notes and reading sessions that sync beside the library
(`AccountRecords` in Sources/LibrarySync.swift) run against a fake server with
the real server's rule, on real files.
"""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
from production_tag_catalog import production_tag_catalog

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--configuration", choices=["debug", "release"], default="debug")
arguments = parser.parse_args()
root = Path(__file__).resolve().parents[1]
store = (root / "Sources/ArticleStore.swift").read_text()
models = store[store.index("struct SavedArticle:"):store.index("struct ImportSummary:")]
sync = (root / "Sources/LibrarySync.swift").read_text()
records = sync[sync.index("/// A record that syncs whole"):sync.index("#if DEBUG\n  /// UI tests sign in")]
with tempfile.TemporaryDirectory(prefix="arctic-records-check-") as directory:
    package = Path(directory)
    target = package / "Sources/AccountRecordsBridge"
    tests = package / "Tests/AccountRecordsBridgeTests"
    target.mkdir(parents=True)
    tests.mkdir(parents=True)
    (package / "Package.swift").write_text(
        '// swift-tools-version: 6.0\nimport PackageDescription\n'
        'let package = Package(name: "AccountRecordsBridge", platforms: [.macOS(.v14)], '
        f'dependencies: [.package(path: {json.dumps(str(root / "Sync"))})], '
        'targets: [.target(name: "AccountRecordsBridge", dependencies: [.product(name: "ArcticSync", package: "Sync")]), '
        '.testTarget(name: "AccountRecordsBridgeTests", dependencies: ["AccountRecordsBridge", .product(name: "ArcticSync", package: "Sync")])])\n'
    )
    (target / "Catalog.swift").write_text(production_tag_catalog(root))
    (target / "Models.swift").write_text("import Foundation\n" + models)
    (target / "TestMode.swift").write_text("enum TestMode { static let enabled = false }\n")
    for name in ["ArticleSyncRepository", "AnnotationStore", "ReadingSessions"]:
        (target / f"{name}.swift").write_text((root / f"Sources/{name}.swift").read_text())
    (target / "AccountRecords.swift").write_text("import ArcticSync\nimport Foundation\n\n" + records)
    (tests / "AccountRecordsTests.swift").write_text((root / "Tests/AccountRecordsTests.swift").read_text())
    subprocess.run(["swift", "test", "--package-path", str(package), "-c", arguments.configuration], check=True)
