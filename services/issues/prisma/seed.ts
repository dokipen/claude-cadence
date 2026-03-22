import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_LABELS = [
  { name: "bug", color: "#d73a4a" },
  { name: "enhancement", color: "#a2eeef" },
  { name: "accessibility", color: "#0075ca" },
  { name: "security", color: "#e4e669" },
  { name: "ux", color: "#d876e3" },
  { name: "performance", color: "#f9d0c4" },
];

async function main() {
  for (const label of DEFAULT_LABELS) {
    await prisma.label.upsert({
      where: { name: label.name },
      update: { color: label.color },
      create: label,
    });
  }

  console.log(`Seeded ${DEFAULT_LABELS.length} labels`);

  await prisma.project.upsert({
    where: { name: "claude-cadence" },
    update: {},
    create: {
      name: "claude-cadence",
      repository: "dokipen/claude-cadence",
    },
  });

  console.log("Seeded default project: claude-cadence");
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
