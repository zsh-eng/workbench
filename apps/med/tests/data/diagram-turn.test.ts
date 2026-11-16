import { expect, test } from "vitest";
import { turnDiagram } from "../../src/web/markdown/diagrams";

test("a flowchart turns between top to bottom and left to right, its subgraphs too", () => {
  expect(turnDiagram("flowchart LR\n  A --> B")).toBe("flowchart TB\n  A --> B");
  expect(turnDiagram("flowchart TD\n  A --> B")).toBe("flowchart LR\n  A --> B");
  expect(turnDiagram("graph RL;A-->B")).toBe("graph BT;A-->B");
  // No direction is top to bottom.
  expect(turnDiagram("flowchart\n  A --> B")).toBe("flowchart LR\n  A --> B");
  const nested = "flowchart TD\n  subgraph S\n    direction LR\n    a --> b\n  end\n  S --> c";
  expect(turnDiagram(nested)).toBe(
    "flowchart LR\n  subgraph S\n    direction TB\n    a --> b\n  end\n  S --> c",
  );
  // Turned twice, it runs as it did.
  expect(turnDiagram(turnDiagram("flowchart LR\n  A --> B")!)).toBe("flowchart LR\n  A --> B");
});

test("front matter and directives before the header stay as they are", () => {
  expect(turnDiagram("---\ntitle: Flow\n---\nflowchart LR\n  a --> b")).toBe(
    "---\ntitle: Flow\n---\nflowchart TB\n  a --> b",
  );
  expect(turnDiagram("%%{init: {'theme': 'base'}}%%\n\ngraph LR\n  a --> b")).toBe(
    "%%{init: {'theme': 'base'}}%%\n\ngraph TB\n  a --> b",
  );
});

test("state, class, entity and requirement diagrams turn by their direction line", () => {
  expect(turnDiagram("stateDiagram-v2\n  direction LR\n  [*] --> Idle")).toBe(
    "stateDiagram-v2\n  direction TB\n  [*] --> Idle",
  );
  // Without one they run top to bottom, so a turn adds one.
  expect(turnDiagram("classDiagram\n  Animal <|-- Duck")).toBe(
    "classDiagram\n  direction LR\n  Animal <|-- Duck",
  );
  // A composite state's direction is its own, not the diagram's.
  expect(turnDiagram("stateDiagram-v2\n  state Busy {\n    direction LR\n    a --> b\n  }")).toBe(
    "stateDiagram-v2\n  direction LR\n  state Busy {\n    direction TB\n    a --> b\n  }",
  );
  expect(turnDiagram("erDiagram\n  A ||--o{ B : has")).toBe(
    "erDiagram\n  direction LR\n  A ||--o{ B : has",
  );
});

test("a Git graph turns between left to right and top to bottom", () => {
  expect(turnDiagram("gitGraph\n  commit")).toBe("gitGraph TB:\n  commit");
  expect(turnDiagram("gitGraph TB:\n  commit")).toBe("gitGraph LR:\n  commit");
});

test("a diagram with no direction does not turn", () => {
  expect(turnDiagram("sequenceDiagram\n  A->>B: hi")).toBeUndefined();
  expect(turnDiagram('pie\n  "a": 1')).toBeUndefined();
  expect(turnDiagram("")).toBeUndefined();
});
