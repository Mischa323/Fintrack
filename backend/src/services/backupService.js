const fs = require("fs");
const path = require("path");
const os = require("os");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function getDbPath() {
  const url = process.env.DATABASE_URL || "file:./data/finance.db";
  // Strip file: prefix and query params
  return url.replace(/^file:/, "").split("?")[0];
}

function snapshotPath() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(os.tmpdir(), `fintrack-backup-${ts}.db`);
}

async function createSnapshot() {
  const src = path.resolve(path.join(__dirname, "../../"), getDbPath());
  const dest = snapshotPath();
  fs.copyFileSync(src, dest);
  return dest;
}

async function uploadSMB(config, filePath) {
  const filename = path.basename(filePath);
  const dest = path.join(config.path, filename);
  fs.copyFileSync(filePath, dest);
}

async function uploadSFTP(config, filePath) {
  const SftpClient = require("ssh2-sftp-client");
  const sftp = new SftpClient();
  try {
    await sftp.connect({
      host: config.host,
      port: config.port || 22,
      username: config.username,
      password: config.password,
      privateKey: config.privateKey || undefined,
    });
    const remotePath = `${(config.remotePath || "/").replace(/\/$/, "")}/${path.basename(filePath)}`;
    await sftp.put(filePath, remotePath);
  } finally {
    await sftp.end().catch(() => {});
  }
}

async function uploadOneDrive(config, filePath) {
  const axios = require("axios");
  const tokenResp = await axios.post(
    `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
    new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  const token = tokenResp.data.access_token;
  const filename = path.basename(filePath);
  const folder = (config.folder || "FinTrack").replace(/^\//, "");
  const fileContent = fs.readFileSync(filePath);
  const driveSegment = config.driveId ? `drives/${config.driveId}` : "me/drive";
  await axios.put(
    `https://graph.microsoft.com/v1.0/${driveSegment}/root:/${folder}/${filename}:/content`,
    fileContent,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    }
  );
}

async function uploadGoogleDrive(config, filePath) {
  const { google } = require("googleapis");
  const serviceAccount = typeof config.serviceAccountJson === "string"
    ? JSON.parse(config.serviceAccountJson)
    : config.serviceAccountJson;

  const auth = new google.auth.JWT(
    serviceAccount.client_email,
    null,
    serviceAccount.private_key,
    ["https://www.googleapis.com/auth/drive.file"]
  );

  const drive = google.drive({ version: "v3", auth });
  const filename = path.basename(filePath);
  const requestBody = { name: filename };
  if (config.folderId) requestBody.parents = [config.folderId];

  await drive.files.create({
    requestBody,
    media: {
      mimeType: "application/x-sqlite3",
      body: fs.createReadStream(filePath),
    },
  });
}

async function runBackup() {
  const configs = await prisma.backupConfig.findMany({ where: { enabled: true } });
  if (configs.length === 0) return;

  let snapshotFile = null;
  try {
    snapshotFile = await createSnapshot();
  } catch (err) {
    console.error("Backup snapshot failed:", err.message);
    return;
  }

  for (const cfg of configs) {
    let status = "success";
    try {
      const config = JSON.parse(cfg.configJson || "{}");
      if (cfg.type === "smb") await uploadSMB(config, snapshotFile);
      else if (cfg.type === "sftp") await uploadSFTP(config, snapshotFile);
      else if (cfg.type === "onedrive") await uploadOneDrive(config, snapshotFile);
      else if (cfg.type === "googledrive") await uploadGoogleDrive(config, snapshotFile);
      else throw new Error(`Unknown backup type: ${cfg.type}`);
    } catch (err) {
      console.error(`Backup "${cfg.label}" failed:`, err.message);
      status = err.message.slice(0, 255);
    }
    await prisma.backupConfig.update({
      where: { id: cfg.id },
      data: { lastRunAt: new Date(), lastStatus: status },
    });
  }

  try { fs.unlinkSync(snapshotFile); } catch {}
}

module.exports = { runBackup, createSnapshot, getDbPath };
