const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const round = (n) => Math.round(n * 100) / 100;

// The single place that derives an account balance from its transactions.
//
// A transfer is stored as ONE row on the paying account, so money arriving via
// toAccountId has to be counted too. Two separate copies of this sum existed
// before and both ignored transfers, which quietly produced wrong balances on
// any account that transfers money.
//
// Net effect of transactions on this account. With `afterDate`, only counts
// transactions dated strictly after it — used to anchor the balance to a
// checkpoint so that backfilling older history does not move it.
async function sumTransactions(accountId, afterDate = null) {
  const where = { OR: [{ accountId }, { toAccountId: accountId }] };
  if (afterDate) where.date = { gt: afterDate };

  const transactions = await prisma.transaction.findMany({
    where,
    select: { amount: true, type: true, accountId: true, toAccountId: true },
  });

  return transactions.reduce((sum, t) => {
    if (t.toAccountId === accountId) return sum + Number(t.amount); // transfer in
    if (t.type === "INCOME") return sum + Number(t.amount);
    return sum - Number(t.amount); // expense, or a transfer leaving this account
  }, 0);
}

// The opening balance is a checkpoint that is true as of openingBalanceDate:
// transactions on or before that date are already baked into it, so adding older
// history never changes the balance; only transactions after the checkpoint
// adjust it. With no checkpoint date the account has no anchor yet, so every
// transaction counts (imported history is incomplete, and whatever came before
// the first row lives in openingBalance).
async function recalculateBalance(accountId) {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { openingBalance: true, openingBalanceDate: true },
  });
  if (!account) return null;

  const movements = await sumTransactions(accountId, account.openingBalanceDate || null);
  const balance = round(Number(account.openingBalance) + movements);
  await prisma.account.update({ where: { id: accountId }, data: { balance } });
  return balance;
}

// "Set balance": the user enters what the bank shows today. That figure is the
// balance as of the end of today, so today and everything before it is treated
// as already included — later corrections and backfilled statements from before
// today leave the balance untouched; only transactions dated after today move
// it. The opening balance is derived so the sum still lands on the entered value.
async function reconcileToBalance(accountId, actualBalance) {
  const now = new Date();
  const anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));

  const movementsAfter = await sumTransactions(accountId, anchor);
  const openingBalance = round(Number(actualBalance) - movementsAfter);
  const balance = round(Number(actualBalance));

  await prisma.account.update({
    where: { id: accountId },
    data: { openingBalance, openingBalanceDate: anchor, balance },
  });
  return { openingBalance, openingBalanceDate: anchor, balance, movements: movementsAfter };
}

module.exports = { recalculateBalance, reconcileToBalance, sumTransactions };
