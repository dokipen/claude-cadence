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

const DEFAULT_PROJECT = {
  id: "default-project",
  name: "Default",
  repository: "default/repository",
};

async function main() {
  await prisma.project.upsert({
    where: { id: DEFAULT_PROJECT.id },
    update: { name: DEFAULT_PROJECT.name, repository: DEFAULT_PROJECT.repository },
    create: DEFAULT_PROJECT,
  });

  console.log("Seeded default project");

  for (const label of DEFAULT_LABELS) {
    await prisma.label.upsert({
      where: { name: label.name },
      update: { color: label.color },
      create: label,
    });
  }

  console.log(`Seeded ${DEFAULT_LABELS.length} default labels`);
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
