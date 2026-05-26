import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ftp from "basic-ftp";
import { Writable } from "node:stream";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadEnvLocal(rootDir: string): void {
  const envFile = path.join(rootDir, ".env.local");
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function listDir(client: ftp.Client, p: string): Promise<void> {
  try {
    const entries = await client.list(p);
    console.log(`\n📁 ${p} (${entries.length} entrées)`);
    for (const e of entries.slice(0, 50)) {
      const type = e.isDirectory ? "DIR " : "FILE";
      console.log(`  ${type}  ${e.name}${e.isDirectory ? "/" : ""}  (${e.size} o, ${e.rawModifiedAt ?? "?"})`);
    }
    if (entries.length > 50) console.log(`  … et ${entries.length - 50} autres`);
  } catch (err) {
    console.log(`  ✗ ${p} : ${(err as Error).message}`);
  }
}

async function fetchTextFile(client: ftp.Client, remotePath: string): Promise<string> {
  const chunks: Buffer[] = [];
  const writable = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  await client.downloadTo(writable, remotePath);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  loadEnvLocal(ROOT);
  const client = new ftp.Client(30_000);
  client.ftp.verbose = false;
  await client.access({
    host: process.env.FTP_HOST!,
    user: process.env.FTP_USER!,
    password: process.env.FTP_PASSWORD!,
    secure: false,
  });
  console.log(`Connecté à ${process.env.FTP_HOST}`);

  await listDir(client, "/");
  await listDir(client, "/www");
  await listDir(client, "/www/jeux");
  await listDir(client, "/www/jeux/catan");

  console.log(`\n=== Contenu de /.ovhconfig ===`);
  try {
    console.log(await fetchTextFile(client, "/.ovhconfig"));
  } catch (err) {
    console.log(`✗ ${(err as Error).message}`);
  }

  console.log(`\n=== Première ligne de /www/index.html ===`);
  try {
    const c = await fetchTextFile(client, "/www/index.html");
    console.log(c.slice(0, 400));
  } catch (err) {
    console.log(`✗ ${(err as Error).message}`);
  }

  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
