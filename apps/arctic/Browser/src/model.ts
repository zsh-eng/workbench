import type { TextHighlight } from "@zsh-eng/text-highlighter";
export type Article = {
  id: string;
  url: string;
  title: string;
  description: string;
  author: string;
  tags: string[];
  savedAt: number;
  saved: boolean;
  archived: boolean;
  favourite: boolean;
  bodyPath?: string;
  image?: string;
  minutes?: number;
};
export type AnnotationColor = "yellow" | "green" | "blue" | "magenta";
export type Annotation = {
  id: string;
  articleId: string;
  text: string;
  quote?: TextHighlight;
  color?: AnnotationColor;
  createdAt: number;
};
export type Library = {
  version: 1;
  articles: Article[];
  annotations: Annotation[];
};
export const articlePath = (url: string) => `/read/${encodeURIComponent(url)}`;
export function webURL(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export const sourceName = (url: string) =>
  new URL(url).hostname.replace(/^www\./, "");
