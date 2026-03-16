import { PrismaClient } from "@prisma/client";

const dbUrl = process.env.DATABASE_URL ?? "";
const isLocalDb = dbUrl.includes("test") || dbUrl.includes("dev");
if (!isLocalDb) {
  throw new Error(`Refusing to seed non-local database: ${dbUrl}`);
}

const prisma = new PrismaClient();

async function main() {
  // Clean existing data in reverse dependency order
  await prisma.blockRelation.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.ticketLabel.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.revokedToken.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.label.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();

  // Create test user
  const user = await prisma.user.create({
    data: {
      id: "e2e-test-user",
      githubId: 99999,
      login: "e2e-tester",
      displayName: "E2E Tester",
      avatarUrl: "https://avatars.githubusercontent.com/u/99999",
    },
  });

  // Create refresh token for the test user
  await prisma.refreshToken.create({
    data: {
      token: "e2e-refresh-token-hex-placeholder",
      userId: user.id,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  // Create test project
  const project = await prisma.project.create({
    data: {
      id: "e2e-test-project",
      name: "E2E Test Project",
      repository: "test-org/test-repo",
    },
  });

  // Create second project (for project switching tests)
  const project2 = await prisma.project.create({
    data: {
      id: "e2e-test-project-2",
      name: "E2E Empty Project",
      repository: "test-org/empty-repo",
    },
  });

  // Create a ticket in second project to verify switching
  await prisma.ticket.create({
    data: {
      number: 5,
      title: "Other project ticket",
      description: "A ticket in the second project",
      state: "BACKLOG",
      priority: "LOW",
      projectId: project2.id,
    },
  });

  // Create labels
  const bugLabel = await prisma.label.create({
    data: { name: "bug", color: "#d73a4a" },
  });
  const enhancementLabel = await prisma.label.create({
    data: { name: "enhancement", color: "#a2eeef" },
  });

  // Create tickets in each state
  const backlogTicket = await prisma.ticket.create({
    data: {
      number: 1,
      title: "Backlog ticket",
      description: "A ticket in backlog state",
      state: "BACKLOG",
      priority: "LOW",
      projectId: project.id,
    },
  });

  const refinedTicket = await prisma.ticket.create({
    data: {
      number: 2,
      title: "Refined ticket",
      description: "A ticket in refined state",
      acceptanceCriteria: "- [ ] Criteria one\n- [ ] Criteria two",
      state: "REFINED",
      priority: "MEDIUM",
      storyPoints: 3,
      assigneeId: user.id,
      projectId: project.id,
    },
  });

  const inProgressTicket = await prisma.ticket.create({
    data: {
      number: 3,
      title: "In-progress ticket",
      description: "A ticket being worked on",
      state: "IN_PROGRESS",
      priority: "HIGH",
      storyPoints: 5,
      assigneeId: user.id,
      projectId: project.id,
    },
  });

  const closedTicket = await prisma.ticket.create({
    data: {
      number: 4,
      title: "Closed ticket",
      description: "A completed ticket",
      state: "CLOSED",
      priority: "MEDIUM",
      storyPoints: 2,
      projectId: project.id,
    },
  });

  const markdownTicket = await prisma.ticket.create({
    data: {
      number: 6,
      title: "Markdown ticket",
      description: `Check out [Example](https://example.com) for more.

This has **bold text** and \`code\` inline.

- Item one
- Item two
- Item three`,
      state: "BACKLOG",
      priority: "LOW",
      projectId: project.id,
    },
  });

  // Add comment with markdown on the markdown ticket
  await prisma.comment.create({
    data: {
      body: `See [the docs](https://example.com/docs) for details. Use \`npm install\` to get started.

**Important:** this is a **bold** note.`,
      ticketId: markdownTicket.id,
      authorId: user.id,
    },
  });

  // Attach labels
  await prisma.ticketLabel.create({
    data: { ticketId: backlogTicket.id, labelId: bugLabel.id },
  });
  await prisma.ticketLabel.create({
    data: { ticketId: refinedTicket.id, labelId: enhancementLabel.id },
  });

  // Add comments
  await prisma.comment.create({
    data: {
      body: "This is a test comment on the refined ticket.",
      ticketId: refinedTicket.id,
      authorId: user.id,
    },
  });

  // Create blocking relationship: in-progress blocks refined
  await prisma.blockRelation.create({
    data: {
      blockerId: inProgressTicket.id,
      blockedId: refinedTicket.id,
    },
  });

  console.log("E2E seed data created successfully");
  console.log(`  User: ${user.login} (${user.id})`);
  console.log(`  Project 1: ${project.name} (${project.id})`);
  console.log(`  Project 2: ${project2.name} (${project2.id})`);
  console.log(`  Tickets: 6 (5 in project 1, 1 in project 2)`);
  console.log(`  Labels: 2, Comments: 3, Block relations: 1`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
