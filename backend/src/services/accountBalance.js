const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// The single place that derives an account balance from its transactions.
//
// A transfer is stored as ONE row on the paying account, so money arriving via
// toAccountId has to be counted too. Two separate copies of this sum existed
// before and both ignored transfers, which quietly produced wrong balances on
// any account that transfers money.
async function recalculateBalance(accountId) {
  const transactions = await prisma.transaction.findMany({
    where: { OR: [{ accountId }, { toAccountId: accountId }] },
    select: { amount: true, type: true, accountId: true, toAccountId: true },
  });

  const balance = transactions.reduce((sum, t) => {
    if (t.toAccountId === accountId) return sum + Number(t.amount); // transfer in
    if (t.type === "INCOME") return sum + Number(t.amount);
    return sum - Number(t.amount); // expense, or a transfer leaving this account
  }, 0);

  const rounded = Math.round(balance * 100) / 100;
  await prisma.account.update({ where: { id: accountId }, data: { balance: rounded } });
  return rounded;
}

module.exports = { recalculateBalance };
