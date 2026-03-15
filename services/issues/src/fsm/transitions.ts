export type TicketState = 'BACKLOG' | 'REFINED' | 'IN_PROGRESS' | 'CLOSED';

export const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  BACKLOG: ['REFINED'],
  REFINED: ['IN_PROGRESS', 'BACKLOG'],
  IN_PROGRESS: ['CLOSED', 'REFINED'],
  CLOSED: ['BACKLOG'],
};
