// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "ArcticSync",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [.library(name: "ArcticSync", targets: ["ArcticSync"])],
  targets: [
    .target(name: "ArcticSync", linkerSettings: [.linkedLibrary("sqlite3")]),
    .testTarget(name: "ArcticSyncTests", dependencies: ["ArcticSync"]),
  ]
)
