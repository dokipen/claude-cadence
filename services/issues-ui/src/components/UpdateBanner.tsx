import styles from "../styles/banner.module.css";

interface UpdateBannerProps {
  onDismiss: () => void;
}

export function UpdateBanner({ onDismiss }: UpdateBannerProps) {
  return (
    <div className={styles.banner} role="status">
      <span className={styles.message}>New version available</span>
      <button
        className={styles.refreshBtn}
        onClick={() => window.location.reload()}
      >
        Refresh
      </button>
      <button
        className={styles.dismissBtn}
        onClick={onDismiss}
        aria-label="Dismiss update notification"
      >
        ×
      </button>
    </div>
  );
}
