import Foundation

/// XXH64 with seed 0, as the shared API names files: "xxh64:" and 16 hex
/// digits (Browser/src/sync/xxh64.ts). The server hashes every upload again
/// and refuses a mismatch.
public enum XXH64 {
  public static func fileID(_ bytes: Data) -> String {
    let hex = String(hash(bytes), radix: 16)
    return "xxh64:" + String(repeating: "0", count: 16 - hex.count) + hex
  }

  private static let p1: UInt64 = 0x9E37_79B1_85EB_CA87
  private static let p2: UInt64 = 0xC2B2_AE3D_27D4_EB4F
  private static let p3: UInt64 = 0x1656_67B1_9E37_79F9
  private static let p4: UInt64 = 0x85EB_CA77_C2B2_AE63
  private static let p5: UInt64 = 0x27D4_EB2F_1656_67C5

  static func hash(_ data: Data) -> UInt64 {
    func rotl(_ x: UInt64, _ r: UInt64) -> UInt64 { (x << r) | (x >> (64 - r)) }
    func round(_ acc: UInt64, _ input: UInt64) -> UInt64 { rotl(acc &+ input &* p2, 31) &* p1 }
    func merge(_ acc: UInt64, _ value: UInt64) -> UInt64 { (acc ^ round(0, value)) &* p1 &+ p4 }
    return data.withUnsafeBytes { bytes in
      func u64(_ at: Int) -> UInt64 {
        UInt64(littleEndian: bytes.loadUnaligned(fromByteOffset: at, as: UInt64.self))
      }
      func u32(_ at: Int) -> UInt64 {
        UInt64(UInt32(littleEndian: bytes.loadUnaligned(fromByteOffset: at, as: UInt32.self)))
      }
      let length = bytes.count
      var offset = 0
      var hash: UInt64
      if length >= 32 {
        var v1 = p1 &+ p2
        var v2 = p2
        var v3: UInt64 = 0
        var v4 = 0 &- p1
        while offset + 32 <= length {
          v1 = round(v1, u64(offset))
          v2 = round(v2, u64(offset + 8))
          v3 = round(v3, u64(offset + 16))
          v4 = round(v4, u64(offset + 24))
          offset += 32
        }
        hash = rotl(v1, 1) &+ rotl(v2, 7) &+ rotl(v3, 12) &+ rotl(v4, 18)
        hash = merge(merge(merge(merge(hash, v1), v2), v3), v4)
      } else {
        hash = p5
      }
      hash &+= UInt64(length)
      while offset + 8 <= length {
        hash ^= round(0, u64(offset))
        hash = rotl(hash, 27) &* p1 &+ p4
        offset += 8
      }
      if offset + 4 <= length {
        hash ^= u32(offset) &* p1
        hash = rotl(hash, 23) &* p2 &+ p3
        offset += 4
      }
      while offset < length {
        hash ^= UInt64(bytes[offset]) &* p5
        hash = rotl(hash, 11) &* p1
        offset += 1
      }
      hash ^= hash >> 33
      hash = hash &* p2
      hash ^= hash >> 29
      hash = hash &* p3
      hash ^= hash >> 32
      return hash
    }
  }
}
