#if os(iOS) && !targetEnvironment(simulator)
let pattern = /(?<year>\d{4})-(?<month>\d{2})/
#else
let pattern = #/[a-z]+\//#
#endif
let raw = #"a "quoted" \#(value) string"#
let block = """
    first \(1 + 2)
    """
infix operator <~>: AdditionPrecedence
enum Shape { case circle(radius: Double), square(Double) }
@available(iOS 17, macOS 14, *)
func area(_ shape: Shape) -> Double {
    guard case let .circle(r) = shape else { return 0x1p-2 }
    return .pi * r * r
}
