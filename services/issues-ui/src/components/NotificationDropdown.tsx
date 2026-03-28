import { useState, useRef, useEffect } from "react";
import { Link } from "react-router";
import type { AgentSession } from "../hooks/useAllSessions";
import { useTicketByNumber } from "../hooks/useTicketByNumber";
import { sendSessionInput } from "../api/agentHubClient";
import layoutStyles from "../styles/layout.module.css";
import { stripProjectPrefix } from "../utils/sessionName";

interface NotificationDropdownProps {
  waitingSessions: AgentSession[];
  projectId: string | undefined;
  projectName: string | null;
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

function parseTicketNumber(sessionName: string): number | null {
  const match = sessionName.match(/^lead-(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function parseSelectPrompt(context: string): { question: string; options: string[]; currentIndex: number } {
  const lines = context.split("\n").filter((l) => l.trim());
  const questionIdx = lines.findIndex((l) => l.trimStart().startsWith("?"));
  const optionLines = lines.slice(questionIdx + 1);
  const options = optionLines.map((l) => l.replace(/^[\s❯]+/, "").trim()).filter(Boolean);
  const currentIndex = optionLines.findIndex((l) => l.includes("❯"));
  const safeCurrentIndex = currentIndex === -1 ? 0 : currentIndex;
  const question = questionIdx >= 0 ? lines[questionIdx].replace(/^\?+\s*/, "") : "";
  return { question, options, currentIndex: safeCurrentIndex };
}

interface NotificationItemProps {
  ws: AgentSession;
  projectId: string | undefined;
  projectName: string | null;
  onClose: () => void;
}

function NotificationItem({ ws, projectId, projectName, onClose }: NotificationItemProps) {
  const [sent, setSent] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const ticketNumber = parseTicketNumber(ws.session.name);
  const { ticket } = useTicketByNumber(projectId, ticketNumber ?? undefined);

  const linkTo = `/agents?session=${encodeURIComponent(ws.agentName)}:${encodeURIComponent(ws.session.id)}`;

  const promptContext = ws.session.promptContext ?? "";
  const promptType = ws.session.promptType ?? "";

  async function handleSend(text: string, e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
    setError(null);
    try {
      await sendSessionInput(ws.agentName, ws.session.id, text);
      setSent(true);
      setTimeout(() => setSent(false), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    }
  }

  function buildSelectInput(targetIndex: number): string {
    const { currentIndex: safeCurrentIndex, options } = parseSelectPrompt(promptContext);
    const delta = targetIndex - safeCurrentIndex;
    if (delta === 0) return "\r";
    const key = delta > 0 ? "\x1b[B" : "\x1b[A";
    const cappedAbs = Math.min(Math.abs(delta), options.length - 1);
    return key.repeat(cappedAbs) + "\r";
  }

  return (
    <Link
      to={linkTo}
      className={layoutStyles.notificationItem}
      onClick={onClose}
      data-testid="notification-item"
    >
      <div className={layoutStyles.notificationItemBody}>
        <div>
          {projectName && (
            <span className={layoutStyles.notificationProjectBadge}>
              {projectName}
            </span>
          )}
          <span className={layoutStyles.notificationTicketTitle}>
            {ticket ? `#${ticket.number} ${ticket.title}` : stripProjectPrefix(ws.session.name)}
          </span>
        </div>
        <div>
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
        </div>
        {promptContext && (
          <pre className={layoutStyles.notificationPromptText}>
            {promptContext}
          </pre>
        )}
        {promptType === "yesno" && (
          <div
            className={layoutStyles.notificationControlsRow}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className={`${layoutStyles.notificationControlBtn} ${layoutStyles.notificationControlBtnPrimary}`}
              disabled={sent}
              onClick={(e) => handleSend("y\n", e)}
              data-testid="btn-yes"
            >
              {sent ? "Sent" : "Yes"}
            </button>
            <button
              className={layoutStyles.notificationControlBtn}
              disabled={sent}
              onClick={(e) => handleSend("n\n", e)}
              data-testid="btn-no"
            >
              {sent ? "Sent" : "No"}
            </button>
          </div>
        )}
        {promptType === "select" && (
          <div
            className={layoutStyles.notificationControlsRow}
            onClick={(e) => e.stopPropagation()}
          >
            {parseSelectPrompt(promptContext).options.map((option, idx) => (
              <button
                key={idx}
                className={layoutStyles.notificationControlBtn}
                disabled={sent}
                onClick={(e) => handleSend(buildSelectInput(idx), e)}
                data-testid={`btn-option-${idx}`}
              >
                {sent ? "Sent" : option}
              </button>
            ))}
          </div>
        )}
        {(promptType === "text" || promptType === "shell" || promptType === "") && (
          <div
            className={layoutStyles.notificationInputRow}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              className={layoutStyles.notificationTextInput}
              type="text"
              value={textInput}
              disabled={sent}
              onChange={(e) => { setTextInput(e.target.value); setError(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void handleSend(textInput + "\n", e);
                  setTextInput("");
                }
              }}
              data-testid="text-input"
            />
            <button
              className={layoutStyles.notificationControlBtn}
              disabled={sent}
              onClick={(e) => {
                void handleSend(textInput + "\n", e);
                setTextInput("");
              }}
              data-testid="btn-send"
            >
              {sent ? "Sent" : "Send"}
            </button>
          </div>
        )}
        {error && (
          <div
            className={layoutStyles.notificationError}
            onClick={(e) => e.stopPropagation()}
            data-testid="send-error"
          >
            {error}
          </div>
        )}
      </div>
    </Link>
  );
}

export function NotificationDropdown({ waitingSessions, projectId, projectName }: NotificationDropdownProps) {
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
          {waitingSessions.map((ws) => (
            <NotificationItem
              key={`${ws.agentName}:${ws.session.id}`}
              ws={ws}
              projectId={projectId}
              projectName={projectName}
              onClose={() => setOpen(false)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
