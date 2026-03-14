-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "githubId" INTEGER NOT NULL,
    "login" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "acceptanceCriteria" TEXT,
    "state" TEXT NOT NULL DEFAULT 'BACKLOG',
    "storyPoints" INTEGER,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "assigneeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Label" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TicketLabel" (
    "ticketId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,

    PRIMARY KEY ("ticketId", "labelId"),
    CONSTRAINT "TicketLabel_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TicketLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "body" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Comment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BlockRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BlockRelation_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "Ticket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BlockRelation_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "Ticket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_githubId_key" ON "User"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "User_login_key" ON "User"("login");

-- CreateIndex
CREATE UNIQUE INDEX "Label_name_key" ON "Label"("name");

-- CreateIndex
CREATE UNIQUE INDEX "BlockRelation_blockerId_blockedId_key" ON "BlockRelation"("blockerId", "blockedId");
