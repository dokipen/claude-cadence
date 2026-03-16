import layoutStyles from "../styles/layout.module.css";

interface NotificationBadgeProps {
  count: number;
}

export function NotificationBadge({ count }: NotificationBadgeProps) {
  if (count === 0) return null;

  return (
    <span className={layoutStyles.notificationBadge} data-testid="notification-badge">
      {count > 99 ? "99+" : count}
    </span>
  );
}
