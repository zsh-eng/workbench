import { z } from "zod";
import { browseSourceSchema } from "./browse";

export const symbolMatchSchema = z.object({
  name: z.string(),
  kind: z.string(),
  path: z.string(),
  line: z.number().int().positive().max(200_000),
  column: z.number().int().positive().optional(),
  scope: z.string().optional(),
});
export type SymbolMatch = z.infer<typeof symbolMatchSchema>;
export const symbolSearchRequestSchema = z.object({
  source: browseSourceSchema,
  query: z
    .string()
    .max(256)
    .regex(/^[^\0\r\n]*$/),
  path: z.string().min(1).max(4096).optional(),
  identity: z.string().max(8192).optional(),
});
export type SymbolSearchRequest = z.infer<typeof symbolSearchRequestSchema>;
export const symbolSearchSchema = z.object({
  source: browseSourceSchema,
  resultSource: browseSourceSchema.optional(),
  path: z.string().optional(),
  identity: z.string().optional(),
  query: z.string(),
  matches: z.array(symbolMatchSchema),
  truncated: z.boolean(),
  engine: z.enum(["ctags", "zoekt"]),
  unavailable: z.string().optional(),
});
export type SymbolSearch = z.infer<typeof symbolSearchSchema>;

/** A hover over a name in a file: its definitions, found as `gd` finds them. */
export const symbolHoverRequestSchema = z.object({
  source: browseSourceSchema,
  path: z.string().min(1).max(4096),
  identity: z.string().max(8192),
  name: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[\p{L}_$][\p{L}\p{N}_$]*$/u),
});
export type SymbolHoverRequest = z.infer<typeof symbolHoverRequestSchema>;
export const symbolDefinitionSchema = symbolMatchSchema.extend({
  /** The checkout or commit whose file holds it. */
  source: browseSourceSchema,
  /** The lines that declare it, and its doc comment, from its file. */
  signature: z.array(z.string()),
  doc: z.array(z.string()),
});
export type SymbolDefinition = z.infer<typeof symbolDefinitionSchema>;
export const symbolHoverSchema = z.object({
  source: browseSourceSchema,
  path: z.string(),
  identity: z.string(),
  name: z.string(),
  definitions: z.array(symbolDefinitionSchema),
  /** Definitions found beyond those shown. */
  more: z.number().int().nonnegative(),
  unavailable: z.string().optional(),
});
export type SymbolHover = z.infer<typeof symbolHoverSchema>;
