require("dotenv").config();
require("express-async-errors");
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");

const accountsRouter = require("./routes/accounts");
const transactionsRouter = require("./routes/transactions");
const categoriesRouter = require("./routes/categories");
const recurringRouter = require("./routes/recurring");
const importRouter = require("./routes/import");
const statsRouter = require("./routes/stats");
const { processRecurring } = require("./services/recurringService");
const { errorHandler } = require("./middleware/errorHandler");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use("/accounts", accountsRouter);
app.use("/transactions", transactionsRouter);
app.use("/categories", categoriesRouter);
app.use("/recurring", recurringRouter);
app.use("/import", importRouter);
app.use("/stats", statsRouter);

app.get("/health", (_, res) => res.json({ status: "ok" }));

app.use(errorHandler);

// Process recurring transactions daily at midnight
cron.schedule("0 0 * * *", () => {
  processRecurring().catch(console.error);
});

app.listen(PORT, () => {
  console.log(`Finance tracker backend running on port ${PORT}`);
});
