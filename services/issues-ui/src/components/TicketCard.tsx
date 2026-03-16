import { Link } from "react-router";
import type { Ticket } from "../types";
import { PriorityBadge } from "./PriorityBadge";
import { LabelBadge } from "./LabelBadge";
import styles from "../styles/card.module.css";

export function TicketCard({ ticket }: { ticket: Ticket }) {
  return (
    <Link to={`/ticket/${ticket.id}`} className={styles.cardLink} data-testid="ticket-card">
      <div className={styles.cardTitle} data-testid="card-title">{ticket.title}</div>
      <div className={styles.cardMeta}>
        <PriorityBadge priority={ticket.priority} />
        {ticket.labels.map((label) => (
          <LabelBadge key={label.id} label={label} />
        ))}
      </div>
      <div className={styles.cardFooter}>
        {ticket.assignee && (
          <span className={styles.assignee} data-testid="assignee">
            {ticket.assignee.avatarUrl?.startsWith("https://") ? (
              <img
                src={ticket.assignee.avatarUrl}
                alt={ticket.assignee.login}
                className={styles.avatar}
              />
            ) : (
              <span className={styles.avatarFallback}>
                {ticket.assignee.login[0].toUpperCase()}
              </span>
            )}
            <span className={styles.assigneeLogin}>{ticket.assignee.login}</span>
          </span>
        )}
        {ticket.storyPoints != null && (
          <span className={styles.storyPoints} data-testid="story-points">
            {ticket.storyPoints}
          </span>
        )}
      </div>
    </Link>
  );
}
