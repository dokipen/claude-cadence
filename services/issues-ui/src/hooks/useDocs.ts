import { useState, useEffect } from "react";
import { fetchDocFiles, fetchDocContent } from "../api/docsClient";
import type { DocFile } from "../api/docsClient";

interface UseDocFilesResult {
  files: DocFile[];
  loading: boolean;
  error: string | null;
}

export function useDocFiles(): UseDocFilesResult {
  const [files, setFiles] = useState<DocFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);

    fetchDocFiles()
      .then((result) => {
        if (!cancelled) {
          setFiles(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Failed to fetch documents");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { files, loading, error };
}

interface UseDocContentResult {
  content: string | null;
  loading: boolean;
  error: string | null;
}

export function useDocContent(path: string | null): UseDocContentResult {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (path === null) {
      setContent(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    setLoading(true);
    setError(null);
    setContent(null);

    fetchDocContent(path)
      .then((result) => {
        if (!cancelled) {
          setContent(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Failed to fetch document content");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  return { content, loading, error };
}
