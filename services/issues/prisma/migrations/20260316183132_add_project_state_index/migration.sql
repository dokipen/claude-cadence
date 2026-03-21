-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Ticket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "acceptanceCriteria" TEXT,
    "state" TEXT NOT NULL DEFAULT 'BACKLOG',
    "storyPoints" INTEGER,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "assigneeId" TEXT,
    "projectId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Ticket_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Ticket" ("acceptanceCriteria", "assigneeId", "createdAt", "description", "id", "number", "priority", "projectId", "state", "storyPoints", "title", "updatedAt") SELECT "acceptanceCriteria", "assigneeId", "createdAt", "description", "id", "number", "priority", "projectId", "state", "storyPoints", "title", "updatedAt" FROM "Ticket";
DROP TABLE "Ticket";
ALTER TABLE "new_Ticket" RENAME TO "Ticket";
CREATE INDEX "Ticket_projectId_state_idx" ON "Ticket"("projectId", "state");
CREATE UNIQUE INDEX "Ticket_projectId_number_key" ON "Ticket"("projectId", "number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
