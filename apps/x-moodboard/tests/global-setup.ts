import { buildFixture, runImport } from "./fixture";

export default function globalSetup() {
  buildFixture();
  runImport();
}
