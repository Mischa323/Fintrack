const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function addPeriod(date, frequency) {
  const d = new Date(date);
  switch (frequency) {
    case "DAILY": d.setDate(d.getDate() + 1); break;
    case "WEEKLY": d.setDate(d.getDate() + 7); break;
    case "BIWEEKLY": d.setDate(d.getDate() + 14); break;
    case "MONTHLY": d.setMonth(d.getMonth() + 1); break;
    case "QUARTERLY": d.setMonth(d.getMonth() + 3); break;
    case "YEARLY": d.setFullYear(d.getFullYear() + 1); break;
  }
  return d;
}

async function processRecurring() {
  const now = new Date();
  const due = await prisma.recurringTransaction.findMany({
    where: { active: true, nextDate: { lte: now } },
  });

  for (const r of due) {
    if (r.endDate && r.nextDate > r.endDate) {
      await prisma.recurringTransaction.update({ where: { id: r.id }, data: { active: false } });
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await tx.transaction.create({
        data: {
          accountId: r.accountId,
          categoryId: r.categoryId,
          amount: r.amount,
          description: r.description,
          date: r.nextDate,
          type: r.type,
          recurringId: r.id,
        },
      });

      const delta = r.type === "INCOME" ? Number(r.amount) : -Number(r.amount);
      await tx.account.update({ where: { id: r.accountId }, data: { balance: { increment: delta } } });

      const nextDate = addPeriod(r.nextDate, r.frequency);
      await tx.recurringTransaction.update({ where: { id: r.id }, data: { nextDate } });
    });
  }

  console.log(`Processed ${due.length} recurring transactions`);
}

module.exports = { processRecurring };
