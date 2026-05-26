import { existsSync, readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ftp from "basic-ftp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

function loadEnvLocal(rootDir: string): void {
  const envFile = path.join(rootDir, ".env.local");
  if (!existsSync(envFile)) return;
  const content = readFileSync(envFile, "utf8");
  for (const line of content.split("\n")) {
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

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`✗ Variable d'environnement manquante : ${name}`);
    console.error(`  Renseigne-la dans .env.local (voir .env.example).`);
    process.exit(1);
  }
  return v;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

async function countLocal(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  const walk = async (d: string): Promise<void> => {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile() || e.isSymbolicLink()) {
        files++;
        bytes += statSync(full).size;
      }
    }
  };
  await walk(dir);
  return { files, bytes };
}

async function ensureRemoteDir(client: ftp.Client, remoteDir: string): Promise<void> {
  if (remoteDir === "" || remoteDir === "/") return;
  await client.ensureDir(remoteDir);
}

async function uploadDir(
  client: ftp.Client,
  localDir: string,
  remoteDir: string,
  options: { dryRun: boolean; verbose: boolean },
): Promise<{ uploaded: number; bytes: number }> {
  let uploaded = 0;
  let bytes = 0;
  const stats = await countLocal(localDir);
  console.log(`→ Local : ${stats.files} fichiers, ${formatBytes(stats.bytes)}`);
  console.log(`→ Cible : ${remoteDir} (sur ${process.env.FTP_HOST})`);
  if (options.dryRun) {
    console.log(`\n(dry-run — aucun envoi)`);
    return { uploaded: 0, bytes: 0 };
  }
  await ensureRemoteDir(client, remoteDir);
  client.trackProgress((info) => {
    if (info.name && info.type === "upload") {
      uploaded++;
      bytes = info.bytesOverall;
      const tag = options.verbose ? `\n` : `\r`;
      process.stdout.write(
        `${tag}↑ ${uploaded} fichiers, ${formatBytes(bytes)}  — dernier : ${info.name}`,
      );
    }
  });
  await client.uploadFromDir(localDir, remoteDir);
  client.trackProgress();
  process.stdout.write("\n");
  return { uploaded, bytes };
}

async function main(): Promise<void> {
  loadEnvLocal(ROOT);

  const host = requireEnv("FTP_HOST");
  const user = requireEnv("FTP_USER");
  const password = requireEnv("FTP_PASSWORD");
  const remoteDir = process.env.FTP_REMOTE_DIR || "/www";
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const verbose = args.includes("--verbose");
  // FTP clair par défaut (OVH mutualisé ne supporte pas TLS sur cluster100).
  // Opt-in avec --tls si l'hébergeur le supporte.
  const secure = args.includes("--tls");

  if (!existsSync(DIST)) {
    console.error(`✗ Le dossier dist/ n'existe pas. Lance 'npm run build' d'abord.`);
    process.exit(1);
  }

  console.log(`Déploiement sur ${host} (${user})${dryRun ? " — DRY RUN" : ""}\n`);

  const client = new ftp.Client(60_000);
  client.ftp.verbose = false;

  try {
    await client.access({
      host,
      user,
      password,
      secure,
      secureOptions: { rejectUnauthorized: false },
    });
    console.log(`✓ Connecté.`);

    const t0 = Date.now();
    const result = await uploadDir(client, DIST, remoteDir, { dryRun, verbose });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    if (!dryRun) {
      console.log(`\n✓ Déploiement terminé en ${dt}s.`);
      console.log(`  ${result.uploaded} fichiers envoyés (${formatBytes(result.bytes)}).`);
      console.log(`\nVérifie maintenant : https://regles-jeu-societe.fr/`);
    }
  } catch (err) {
    console.error(`\n✗ Erreur :`, (err as Error).message);
    process.exit(1);
  } finally {
    client.close();
  }
}

main();
