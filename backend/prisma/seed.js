const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const categories = [
    { name: "Housing", color: "#f59e0b", icon: "🏠" },
    { name: "Food & Dining", color: "#10b981", icon: "🍔" },
    { name: "Transportation", color: "#3b82f6", icon: "🚗" },
    { name: "Health & Fitness", color: "#ec4899", icon: "💪" },
    { name: "Entertainment", color: "#8b5cf6", icon: "🎬" },
    { name: "Shopping", color: "#f97316", icon: "🛍️" },
    { name: "Utilities", color: "#06b6d4", icon: "⚡" },
    { name: "Income", color: "#22c55e", icon: "💰" },
    { name: "Savings", color: "#14b8a6", icon: "🏦" },
    { name: "Other", color: "#6b7280", icon: "📦" },
  ];

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { name: cat.name },
      update: {},
      create: cat,
    });
  }

  console.log("Seed complete");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
