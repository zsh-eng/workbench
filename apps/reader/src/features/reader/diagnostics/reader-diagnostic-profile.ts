import { DEFAULT_PARAGRAPH_SPACING } from "@/lib/pagination-v2";
import type { ReaderSettings } from "@/types/reader.types";
import { resolvePaginatedReaderLayout } from "../hooks/use-paginated-reader-layout";

export interface ReaderDiagnosticProfile {
  name: string;
  container: { width: number; height: number };
  isMobile: boolean;
  settings: ReaderSettings;
  paragraphSpacingFactor: number;
}

export const DEFAULT_READER_DIAGNOSTIC_PROFILE: ReaderDiagnosticProfile = {
  name: "mobile-baseline",
  container: { width: 390, height: 844 },
  isMobile: true,
  settings: {
    fontSize: 16,
    lineHeight: 1.5,
    fontFamily: "iowan",
    theme: "light",
    textAlign: "left",
    contentWidth: "medium",
    publisherBookStylingEnabled: false,
    matchPublisherBodyTextSize: false,
    pageAnimationsEnabled: true,
    showPageNumbers: true,
  },
  paragraphSpacingFactor: DEFAULT_PARAGRAPH_SPACING,
};

/** An iPad held upright (820 × 1180), for benchmarks at tablet width. */
export const IPAD_READER_DIAGNOSTIC_PROFILE: ReaderDiagnosticProfile = {
  ...DEFAULT_READER_DIAGNOSTIC_PROFILE,
  name: "ipad-portrait",
  container: { width: 820, height: 1180 },
  isMobile: false,
};

/** `?profile=ipad` picks the iPad profile; anything else the phone. */
export function resolveReaderDiagnosticProfile(
  search: string,
): ReaderDiagnosticProfile {
  return new URLSearchParams(search).get("profile") === "ipad"
    ? IPAD_READER_DIAGNOSTIC_PROFILE
    : DEFAULT_READER_DIAGNOSTIC_PROFILE;
}

export function resolveReaderDiagnosticLayout(
  profile: ReaderDiagnosticProfile = DEFAULT_READER_DIAGNOSTIC_PROFILE,
) {
  return resolvePaginatedReaderLayout({
    stageWidth: profile.container.width,
    stageHeight: profile.container.height,
    isMobile: profile.isMobile,
  });
}
