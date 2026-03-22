import { useParams, useNavigate } from "react-router";
import { useDocFiles, useDocContent } from "../hooks/useDocs";
import { Markdown } from "./Markdown";
import styles from "../styles/docs.module.css";

export function DocsPage() {
  const { files, loading: filesLoading, error: filesError } = useDocFiles();
  const params = useParams<{ "*": string }>();
  const navigate = useNavigate();
  const selectedPath = params["*"] || null;
  const { content, loading: contentLoading, error: contentError } = useDocContent(selectedPath);

  return (
    <div className={styles.container}>
      <nav className={styles.nav}>
        <div className={styles.navHeader}>Documents</div>
        {filesLoading && (
          <p className={styles.statusText} style={{ padding: "0.75rem 1rem" }}>
            Loading…
          </p>
        )}
        {filesError && (
          <p className={styles.statusText} style={{ padding: "0.75rem 1rem", color: "var(--error)" }}>
            {filesError}
          </p>
        )}
        {!filesLoading && !filesError && (
          <ul className={styles.fileList}>
            {files.map((file) => (
              <li key={file.path}>
                <button
                  className={`${styles.fileItem}${selectedPath === file.path ? ` ${styles.fileItemSelected}` : ""}`}
                  onClick={() => navigate(`/docs/${file.path}`)}
                  title={file.path}
                >
                  {file.path}
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <div className={styles.content}>
        {selectedPath === null ? (
          <div className={styles.emptyState}>Select a document to preview</div>
        ) : contentLoading ? (
          <p className={styles.statusText}>Loading…</p>
        ) : contentError ? (
          <p className={styles.statusText} style={{ color: "var(--error)" }}>
            {contentError}
          </p>
        ) : content !== null ? (
          <Markdown>{content}</Markdown>
        ) : null}
      </div>
    </div>
  );
}
