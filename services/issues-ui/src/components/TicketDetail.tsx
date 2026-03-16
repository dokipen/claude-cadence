import { useParams, Link } from "react-router";
import { useTicket } from "../hooks/useTicket";
import { PriorityBadge } from "./PriorityBadge";
import { LabelBadge } from "./LabelBadge";
import type { Comment as CommentType, RelatedTicket, TicketState } from "../types";
import styles from "../styles/detail.module.css";

const STATE_LABELS: Record<TicketState, { label: string; className: string }> = {
  BACKLOG: { label: "Backlog", className: styles.stateBacklog },
  REFINED: { label: "Refined", className: styles.stateRefined },
  IN_PROGRESS: { label: "In Progress", className: styles.stateInProgress },
  CLOSED: { label: "Closed", className: styles.stateClosed },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CommentList({ comments }: { comments: CommentType[] }) {
  if (comments.length === 0) {
    return <p className={styles.emptyComments} data-testid="no-comments">No comments yet.</p>;
  }

  return (
    <div className={styles.commentList} data-testid="detail-comments">
      {comments.map((comment) => (
        <div key={comment.id} className={styles.comment} data-testid="comment">
          <div className={styles.commentHeader}>
            {comment.author.avatarUrl?.startsWith("https://") ? (
              <img
                src={comment.author.avatarUrl}
                alt={comment.author.login}
                className={styles.commentAvatar}
              />
            ) : (
              <span className={styles.commentAvatarFallback}>
                {comment.author.login[0].toUpperCase()}
              </span>
            )}
            <span className={styles.commentAuthor}>{comment.author.displayName || comment.author.login}</span>
            <span className={styles.commentDate}>{formatDate(comment.createdAt)}</span>
          </div>
          <div className={styles.commentBody} data-testid="comment-body">{comment.body}</div>
        </div>
      ))}
    </div>
  );
}

function BlockingList({
  tickets,
  label,
  testId,
}: {
  tickets: RelatedTicket[];
  label: string;
  testId: string;
}) {
  if (tickets.length === 0) return null;

  return (
    <div className={styles.section} data-testid={testId}>
      <h3 className={styles.sectionTitle}>{label}</h3>
      <div className={styles.blockingList}>
        {tickets.map((t) => {
          const stateConfig = STATE_LABELS[t.state];
          return (
            <Link
              key={t.id}
              to={`/ticket/${t.id}`}
              className={styles.blockingItem}
              data-testid="blocking-ticket"
            >
              <span className={styles.blockingNumber}>#{t.number}</span>
              <span className={styles.blockingTitle}>{t.title}</span>
              <span className={`${styles.stateBadge} ${stateConfig.className}`}>
                {stateConfig.label}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const { ticket, loading, error } = useTicket(id);

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading} data-testid="detail-loading">Loading ticket…</div>
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className={styles.container}>
        <div className={styles.error} data-testid="detail-error">
          {error ? "Failed to load ticket" : "Ticket not found"}
        </div>
      </div>
    );
  }

  const stateConfig = STATE_LABELS[ticket.state];

  return (
    <div className={styles.container} data-testid="ticket-detail">
      <Link to="/" className={styles.backLink} data-testid="back-link">
        &larr; Back to board
      </Link>

      <div className={styles.header}>
        <div className={styles.ticketNumber} data-testid="detail-number">#{ticket.number}</div>
        <h1 className={styles.title} data-testid="detail-title">{ticket.title}</h1>
        <div className={styles.meta}>
          <span
            className={`${styles.stateBadge} ${stateConfig.className}`}
            data-testid="detail-state"
          >
            {stateConfig.label}
          </span>
          <PriorityBadge priority={ticket.priority} />
        </div>
      </div>

      <div className={styles.sidebar}>
        <div className={styles.sidebarItem}>
          <span className={styles.sidebarLabel}>Assignee</span>
          <span className={styles.sidebarValue} data-testid="detail-assignee">
            {ticket.assignee ? (
              <span className={styles.assigneeDisplay}>
                {ticket.assignee.avatarUrl?.startsWith("https://") ? (
                  <img
                    src={ticket.assignee.avatarUrl}
                    alt={ticket.assignee.login}
                    className={styles.assigneeAvatar}
                  />
                ) : (
                  <span className={styles.assigneeAvatarFallback}>
                    {ticket.assignee.login[0].toUpperCase()}
                  </span>
                )}
                {ticket.assignee.displayName || ticket.assignee.login}
              </span>
            ) : (
              <span className={styles.sidebarNone}>Unassigned</span>
            )}
          </span>
        </div>
        <div className={styles.sidebarItem}>
          <span className={styles.sidebarLabel}>Story Points</span>
          <span className={styles.sidebarValue} data-testid="detail-story-points">
            {ticket.storyPoints != null ? ticket.storyPoints : (
              <span className={styles.sidebarNone}>—</span>
            )}
          </span>
        </div>
        <div className={styles.sidebarItem}>
          <span className={styles.sidebarLabel}>Labels</span>
          <span className={styles.sidebarValue} data-testid="detail-labels">
            {ticket.labels.length > 0 ? (
              <span className={styles.labelsRow}>
                {ticket.labels.map((label) => (
                  <LabelBadge key={label.id} label={label} />
                ))}
              </span>
            ) : (
              <span className={styles.sidebarNone}>None</span>
            )}
          </span>
        </div>
        <div className={styles.sidebarItem}>
          <span className={styles.sidebarLabel}>Created</span>
          <span className={styles.sidebarValue}>{formatDate(ticket.createdAt)}</span>
        </div>
      </div>

      {ticket.description && (
        <div className={styles.section} data-testid="detail-description">
          <h3 className={styles.sectionTitle}>Description</h3>
          <div className={styles.body}>{ticket.description}</div>
        </div>
      )}

      {ticket.acceptanceCriteria && (
        <div className={styles.section} data-testid="detail-acceptance-criteria">
          <h3 className={styles.sectionTitle}>Acceptance Criteria</h3>
          <div className={styles.body}>{ticket.acceptanceCriteria}</div>
        </div>
      )}

      <BlockingList tickets={ticket.blockedBy} label="Blocked by" testId="detail-blocked-by" />
      <BlockingList tickets={ticket.blocks} label="Blocks" testId="detail-blocks" />

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Comments</h3>
        <CommentList comments={ticket.comments} />
      </div>
    </div>
  );
}
