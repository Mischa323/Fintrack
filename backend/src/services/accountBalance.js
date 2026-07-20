const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// The single place that derives an account balance from its transactions.
//
// A transfer is stored as ONE row on the paying account, so money arriving via
// toAccountId has to be counted too. Two separate copies of this sum existed
// before and both ignored transfers, which quietly produced wrong balances on
// any account that transfers money.
// Net effect of every recorded transaction on this account.
async function sumTransactions(accountId) {
  const transactions = await prisma.transaction.findMany({
    where: { OR: [{ accountId }, { toAccountId: accountId }] },
    select: { amount: true, type: true, accountId: true, toAccountId: true },
  });

  return transactions.reduce((sum, t) => {
    if (t.toAccountId === accountId) return sum + Number(t.amount); // transfer in
    if (t.type === "INCOME") return sum + Number(t.amount);
    return sum - Number(t.amount); // expense, or a transfer leaving this account
  }, 0);
}

// Imported history is never complete — a statement starts somewhere, and the
// account already had money in it. Summing transactions alone therefore says
// nothing about the real balance, so whatever came before lives in
// openingBalance and the result is opening + movements.
async function recalculateBalance(accountId) {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { openingBalance: true },
  });
  if (!account) return null;

  const movements = await sumTransactions(accountId);
  const balance = Math.round((Number(account.openingBalance) + movements) * 100) / 100;
  await prisma.account.update({ where: { id: accountId }, data: { balance } });
  return balance;
}

// Given the balance the bank actually shows, work backwards to the opening
// balance that makes the recorded transactions add up to it. Later imports then
// keep the balance correct on their own.
async function reconcileToBalance(accountId, actualBalance) {
  const movements = await sumTransactions(accountId);
  const openingBalance = Math.round((Number(actualBalance) - movements) * 100) / 100;
  await prisma.account.update({
    where: { id: accountId },
    data: { openingBalance, balance: Math.round(Number(actualBalance) * 100) / 100 },
  });
  return { openingBalance, balance: Number(actualBalance), movements };
}

module.exports = { recalculateBalance, reconcileToBalance, sumTransactions };
