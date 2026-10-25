/**
 * useFileUrl Hook
 *
 * React hook for fetching opaque file references and returning object URLs.
 * Handles automatic cleanup of object URLs when the component unmounts
 * or the file reference changes.
 */

import { files, type FileId } from "@/lib/files";
import { useEffect, useState } from "react";

interface UseFileUrlState {
  /** The object URL for the file, or undefined if not loaded */
  url: string | undefined;
  /** Whether the file is currently being fetched */
  isLoading: boolean;
  /** Error message if the fetch failed */
  error: string | undefined;
  /** Whether the file was served from local cache */
  fromCache: boolean | undefined;
}

interface UseFileUrlOptions {
  /** If true, skip fetching (useful for conditional loading) */
  skip?: boolean;
  /** If true, only check local storage (no network request) */
  localOnly?: boolean;
}

/**
 * Hook for fetching a file and returning an object URL.
 *
 * @param fileId - The opaque file reference
 * @param options - Optional settings
 * @returns State object with url, isLoading, error, and fromCache
 *
 * @example
 * ```tsx
 * function BookCover({ fileId }: { fileId: FileId }) {
 *   const { url, isLoading, error } = useFileUrl(fileId);
 *
 *   if (isLoading) return <Spinner />;
 *   if (error) return <FallbackCover />;
 *   return <img src={url} alt="Book cover" />;
 * }
 * ```
 */
export function useFileUrl(
  fileId: FileId | undefined,
  options: UseFileUrlOptions = {},
): UseFileUrlState {
  const { skip = false, localOnly = false } = options;

  const [state, setState] = useState<UseFileUrlState>({
    url: undefined,
    isLoading: false,
    error: undefined,
    fromCache: undefined,
  });

  useEffect(() => {
    if (!fileId || skip) {
      setState({
        url: undefined,
        isLoading: false,
        error: undefined,
        fromCache: undefined,
      });
      return;
    }

    let isMounted = true;
    let objectUrl: string | undefined;
    const resolvedFileId = fileId;

    async function fetchFile() {
      setState((prev) => ({ ...prev, isLoading: true, error: undefined }));

      try {
        const fromCache = await files.hasLocal(resolvedFileId);
        if (!fromCache && localOnly) {
          throw new Error(`File not found locally: ${resolvedFileId}`);
        }
        const blob = await files.get(resolvedFileId);

        if (!isMounted) {
          return;
        }

        // Create object URL from blob
        objectUrl = URL.createObjectURL(blob);

        setState({
          url: objectUrl,
          isLoading: false,
          error: undefined,
          fromCache,
        });
      } catch (err) {
        if (!isMounted) {
          return;
        }

        setState({
          url: undefined,
          isLoading: false,
          error: err instanceof Error ? err.message : "Failed to fetch file",
          fromCache: undefined,
        });
      }
    }

    fetchFile();

    // Cleanup: revoke object URL when unmounting or dependencies change
    return () => {
      isMounted = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [fileId, skip, localOnly]);

  return state;
}
