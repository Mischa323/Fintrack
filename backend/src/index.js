require("dotenv").config();
require("express-async-errors");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const cron = require("node-cron");

const authRouter = require("./routes/auth");
const usersRouter = require("./routes/users");
const configRouter = require("./routes/config");
const accountsRouter = require("./routes/accounts");
const transactionsRouter = require("./routes/transactions");
const categoriesRouter = require("./routes/categories");
const recurringRouter = require("./routes/recurring");
const importRouter = require("./routes/import");
const statsRouter = require("./routes/stats");
const goalsRouter = require("./routes/goals");
const backupRouter = require("./routes/backup");
const versionRouter = require("./routes/version");
const holdingsRouter = require("./routes/holdings");
const aiRouter = require("./routes/ai");
const { processRecurring } = require("./services/recurringService");
const { runBackup } = require("./services/backupService");
const { initJwtSecret } = require("./services/jwtSecret");
const { refreshHoldings } = require("./services/quotes");
const { errorHandler } = require("./middleware/errorHandler");
const authMiddleware = require("./middleware/auth");
const { requireAdmin } = require("./middleware/auth");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Auth routes are public
app.use("/auth", authRouter);

// All other routes require a valid JWT
app.use(authMiddleware);
app.use("/users", requireAdmin, usersRouter);
app.use("/config", configRouter);
app.use("/accounts", accountsRouter);
app.use("/transactions", transactionsRouter);
app.use("/categories", categoriesRouter);
app.use("/recurring", recurringRouter);
app.use("/import", importRouter);
app.use("/stats", statsRouter);
app.use("/goals", goalsRouter);
app.use("/backup", requireAdmin, backupRouter);
app.use("/version", versionRouter);
app.use("/holdings", holdingsRouter);
app.use("/ai", aiRouter);

app.get("/health", (_, res) => res.json({ status: "ok" }));

app.use(errorHandler);

cron.schedule("0 0 * * *", () => {
  processRecurring().catch(console.error);
});

// Refresh investment prices on weekday mornings, after European markets settle
cron.schedule("30 6 * * 1-5", () => {
  refreshHoldings().catch(console.error);
});

cron.schedule("0 2 * * *", () => {
  runBackup().catch(console.error);
});

initJwtSecret()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Finance tracker backend running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize JWT secret:", err);
    process.exit(1);
  });
