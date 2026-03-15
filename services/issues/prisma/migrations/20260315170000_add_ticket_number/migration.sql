-- RedefineTables (SQLite requires table recreation for NOT NULL + unique constraint)
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Ticket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "acceptanceCriteria" TEXT,
    "state" TEXT NOT NULL DEFAULT 'BACKLOG',
    "storyPoints" INTEGER,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "assigneeId" TEXT,
    "projectId" TEXT NOT NULL DEFAULT 'default-project',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Ticket_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Copy existing tickets, assigning sequential numbers per project ordered by creation date
INSERT INTO "new_Ticket" ("id", "number", "title", "description", "acceptanceCriteria", "state", "storyPoints", "priority", "assigneeId", "projectId", "createdAt", "updatedAt")
SELECT "id",
       ROW_NUMBER() OVER (PARTITION BY "projectId" ORDER BY "createdAt" ASC),
       "title", "description", "acceptanceCriteria", "state", "storyPoints", "priority", "assigneeId", "projectId", "createdAt", "updatedAt"
FROM "Ticket";

DROP TABLE "Ticket";
ALTER TABLE "new_Ticket" RENAME TO "Ticket";

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_projectId_number_key" ON "Ticket"("projectId", "number");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
