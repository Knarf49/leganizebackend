import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const room = await prisma.room.upsert({
    where: { threadId: "seed-thread-001" },
    update: {},
    create: {
      threadId: "seed-thread-001",
      accessToken: "seed-token-001",
      meetingType: "BOD",
      calledBy: "Seed",
      location: "Boardroom A",
      agendas: ["Review Q1 financials", "Approve annual budget"],
      meetingNo: "1/2569",
      companyType: "LIMITED",
    },
  });

  console.log("Seeded room:", room.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
