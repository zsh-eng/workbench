import { getBookFile } from "@/lib/db";
import {
  cleanupResourceUrls,
  getDeferredEpubImagePath,
} from "@/lib/epub-resource-utils";
import {
  endReaderTraceSpan,
  startReaderTraceSpan,
} from "@/lib/reader-performance-trace";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface DeferredEpubImageStore {
  getUrl: (resourcePath: string) => string | null;
  loadUrl: (resourcePath: string) => Promise<string | null>;
}

const DeferredEpubImageContext = createContext<DeferredEpubImageStore | null>(
  null,
);

interface DeferredEpubImageProviderProps {
  bookId?: string;
  loadResource?: (resourcePath: string) => Promise<Blob | null>;
  children: ReactNode;
}

/**
 * Owns deferred EPUB image object URLs for a single reader session.
 *
 * Images are loaded on demand by descendants, reused while the reader stays
 * open, and revoked together when this provider unmounts.
 */
export function DeferredEpubImageProvider({
  bookId,
  loadResource,
  children,
}: DeferredEpubImageProviderProps) {
  const objectUrlsRef = useRef<Map<string, string>>(new Map());
  const pendingLoadsRef = useRef<Map<string, Promise<string | null>>>(
    new Map(),
  );
  const disposedRef = useRef(false);

  const getUrl = useCallback((resourcePath: string): string | null => {
    return objectUrlsRef.current.get(resourcePath) ?? null;
  }, []);

  const loadUrl = useCallback(
    async (resourcePath: string): Promise<string | null> => {
      const cachedUrl = objectUrlsRef.current.get(resourcePath);
      if (cachedUrl) {
        return cachedUrl;
      }

      const pendingLoad = pendingLoadsRef.current.get(resourcePath);
      if (pendingLoad) {
        return pendingLoad;
      }

      const loadPromise = (async () => {
        const resourceLoadSpan = startReaderTraceSpan(
          "epub-image-resource-load",
          "assets",
          { resourcePath },
        );
        const fileReadSpan = startReaderTraceSpan(
          "epub-image-file-read",
          "storage",
          {
            resourcePath,
            source: loadResource ? "custom-loader" : "indexed-db",
          },
        );
        let resourceBlob: Blob | null = null;

        try {
          resourceBlob = loadResource
            ? await loadResource(resourcePath)
            : bookId
              ? ((await getBookFile(bookId, resourcePath))?.content ?? null)
              : null;
          endReaderTraceSpan(fileReadSpan, {
            found: resourceBlob !== null,
            sizeBytes: resourceBlob?.size ?? 0,
            mediaType: resourceBlob?.type || "unknown",
          });
        } catch (error) {
          endReaderTraceSpan(
            fileReadSpan,
            {
              error: error instanceof Error ? error.message : String(error),
            },
            "error",
          );
          endReaderTraceSpan(resourceLoadSpan, {}, "error");
          throw error;
        }

        if (!resourceBlob) {
          console.warn("[LazyImage] Deferred image not found:", resourcePath);
          endReaderTraceSpan(resourceLoadSpan, { found: false }, "error");
          return null;
        }

        const existingUrl = objectUrlsRef.current.get(resourcePath);
        if (existingUrl) {
          endReaderTraceSpan(resourceLoadSpan, {
            cache: "provider-memory",
            sizeBytes: resourceBlob.size,
          });
          return existingUrl;
        }

        const objectUrlSpan = startReaderTraceSpan(
          "epub-image-object-url-create",
          "assets",
          { resourcePath },
        );
        const objectUrl = URL.createObjectURL(resourceBlob);
        endReaderTraceSpan(objectUrlSpan, { sizeBytes: resourceBlob.size });
        if (disposedRef.current) {
          URL.revokeObjectURL(objectUrl);
          endReaderTraceSpan(resourceLoadSpan, {
            disposed: true,
            sizeBytes: resourceBlob.size,
          });
          return null;
        }

        objectUrlsRef.current.set(resourcePath, objectUrl);
        endReaderTraceSpan(resourceLoadSpan, {
          found: true,
          sizeBytes: resourceBlob.size,
          mediaType: resourceBlob.type || "unknown",
        });
        return objectUrl;
      })();

      pendingLoadsRef.current.set(resourcePath, loadPromise);

      return loadPromise.then(
        (loadedUrl) => {
          pendingLoadsRef.current.delete(resourcePath);
          return loadedUrl;
        },
        (error) => {
          pendingLoadsRef.current.delete(resourcePath);
          throw error;
        },
      );
    },
    [bookId, loadResource],
  );

  useEffect(() => {
    disposedRef.current = false;
    const pendingLoads = pendingLoadsRef.current;
    const objectUrls = objectUrlsRef.current;

    return () => {
      disposedRef.current = true;
      pendingLoads.clear();
      cleanupResourceUrls(objectUrls);
    };
  }, []);

  const store = useMemo<DeferredEpubImageStore>(
    () => ({
      getUrl,
      loadUrl,
    }),
    [getUrl, loadUrl],
  );

  return (
    <DeferredEpubImageContext.Provider value={store}>
      {children}
    </DeferredEpubImageContext.Provider>
  );
}

export function useDeferredEpubImage(src: string) {
  const store = useContext(DeferredEpubImageContext);
  const resourcePath = getDeferredEpubImagePath(src);
  const deferredStore = resourcePath ? store : null;
  const [loadedSrc, setLoadedSrc] = useState<{
    resourcePath: string;
    src: string | null;
  } | null>(null);

  if (resourcePath && !deferredStore) {
    throw new Error(
      "Deferred EPUB images must be rendered within DeferredEpubImageProvider.",
    );
  }

  const cachedSrc =
    resourcePath && deferredStore ? deferredStore.getUrl(resourcePath) : null;
  const resourceLoadSettled = loadedSrc?.resourcePath === resourcePath;
  const resolvedSrc = resourcePath
    ? (cachedSrc ?? (resourceLoadSettled ? loadedSrc.src : null))
    : src;

  useEffect(() => {
    let cancelled = false;

    if (!resourcePath || !deferredStore || cachedSrc || resourceLoadSettled) {
      return () => {
        cancelled = true;
      };
    }

    // A read that fails settles as a missing image, so the page can show.
    void deferredStore
      .loadUrl(resourcePath)
      .catch((error: unknown) => {
        console.warn("[reader] Could not read image", resourcePath, error);
        return null;
      })
      .then((loadedUrl) => {
        if (cancelled) return;
        setLoadedSrc({ resourcePath, src: loadedUrl });
      });

    return () => {
      cancelled = true;
    };
  }, [cachedSrc, deferredStore, resourceLoadSettled, resourcePath]);

  return {
    isLoading: !!resourcePath && !cachedSrc && !resourceLoadSettled,
    resourcePath,
    resolvedSrc,
  };
}
