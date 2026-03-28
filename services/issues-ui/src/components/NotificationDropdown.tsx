import { useState, useRef, useEffect } from "react";
import { Link } from "react-router";
import type { AgentSession } from "../hooks/useAllSessions";
import layoutStyles from "../styles/layout.module.css";
import { stripProjectPrefix } from "../utils/sessionName";

interface NotificationDropdownProps {
  waitingSessions: AgentSession[];
}

function formatIdleDuration(idleSince: string | undefined): string {
  if (!idleSince) return "";
  const seconds = Math.floor((Date.now() - new Date(idleSince).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function NotificationDropdown({ waitingSessions }: NotificationDropdownProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (waitingSessions.length === 0) return null;

  return (
    <div className={layoutStyles.notificationWrapper} ref={dropdownRef}>
      <button
        className={layoutStyles.notificationTrigger}
        onClick={() => setOpen(!open)}
        data-testid="notification-trigger"
        aria-label={`${waitingSessions.length} sessions waiting for input`}
      >
        <span className={layoutStyles.notificationBadge} data-testid="notification-badge">
          {waitingSessions.length > 99 ? "99+" : waitingSessions.length}
        </span>
      </button>
      {open && (
        <div className={layoutStyles.notificationDropdown} data-testid="notification-dropdown">
          <div className={layoutStyles.notificationHeader}>
            Waiting for input
          </div>
          {waitingSessions.map((ws) => {
            const linkTo = `/agents?session=${encodeURIComponent(ws.agentName)}:${encodeURIComponent(ws.session.id)}`;
            return (
              <Link
                key={`${ws.agentName}:${ws.session.id}`}
                to={linkTo}
                className={layoutStyles.notificationItem}
                onClick={() => setOpen(false)}
                data-testid="notification-item"
              >
                <span className={layoutStyles.notificationSessionName}>
                  {stripProjectPrefix(ws.session.name)}
                </span>
                <span className={layoutStyles.notificationAgent}>
                  {ws.agentName}
                </span>
                {ws.session.idleSince && (
                  <span className={layoutStyles.notificationIdle}>
                    {formatIdleDuration(ws.session.idleSince)}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
