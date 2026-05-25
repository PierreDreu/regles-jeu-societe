import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const JEUX_DIR = path.join(ROOT, "data", "jeux");
const PDF_DIR = path.join(JEUX_DIR, "pdf");
const SEED_FILE = path.join(ROOT, "data", "seeds", "urls-pdf.json");

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface SeedEntry {
  bggId: number;
  pdfUrl: string;
  sourcePage?: string;
  langue?: string;
  editeurAffiche?: string;
  note?: string;
}

interface SeedFile {
  urls: Record<string, SeedEntry>;
}

interface JeuJson {
  slug: string;
  bggId: number;
  pdfUrlSource?: string | null;
  pdfLocal?: string | null;
  pdfSourcePage?: string | null;
  pdfLangue?: string | null;
  pdfEditeurAffiche?: string | null;
  pdfNote?: string | null;
  pdfServingMode?: "local" | "redirect" | "unavailable" | null;
  pdfTailleOctets?: number | null;
  pdfDateRecuperation?: string | null;
  [k: string]: unknown;
}

interface FetchResult {
  slug: string;
  ok: boolean;
  message: string;
  bytes?: number;
}

async function loadSeed(): Promise<SeedFile> {
  if (!existsSync(SEED_FILE)) {
    throw new Error(`Seed file missing : ${SEED_FILE}`);
  }
  const raw = JSON.parse(await readFile(SEED_FILE, "utf8")) as SeedFile;
  if (!raw.urls || typeof raw.urls !== "object") {
    throw new Error(`Seed file invalide : champ "urls" manquant ou non-objet`);
  }
  return raw;
}

async function head(url: string): Promise<{ ok: boolean; contentType: string | null; contentLength: number | null; finalUrl: string; status: number }> {
  const res = await fetch(url, {
    method: "HEAD",
    redirect: "follow",
    headers: { "User-Agent": USER_AGENT, Accept: "application/pdf,*/*" },
  });
  return {
    ok: res.ok,
    status: res.status,
    contentType: res.headers.get("content-type"),
    contentLength: res.headers.get("content-length") ? Number(res.headers.get("content-length")) : null,
    finalUrl: res.url,
  };
}

async function downloadPdf(url: string, targetPath: string): Promise<number> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": USER_AGENT, Accept: "application/pdf,*/*" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  const ct = res.headers.get("content-type") ?? "";
  if (!/pdf/i.test(ct) && !/octet-stream/i.test(ct)) {
    throw new Error(`Content-Type inattendu : ${ct} (attendu pdf)`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) {
    throw new Error(`Taille suspecte (${buf.length} octets)`);
  }
  const head = buf.subarray(0, 4).toString("ascii");
  if (head !== "%PDF") {
    throw new Error(`En-tête PDF absente (bytes "${head}")`);
  }
  await writeFile(targetPath, buf);
  return buf.length;
}

async function processOne(slug: string, entry: SeedEntry, options: { force?: boolean }): Promise<FetchResult> {
  const jeuPath = path.join(JEUX_DIR, `${slug}.json`);
  if (!existsSync(jeuPath)) {
    return { slug, ok: false, message: `JSON jeu introuvable (${path.relative(ROOT, jeuPath)})` };
  }
  const jeu = JSON.parse(await readFile(jeuPath, "utf8")) as JeuJson;
  if (jeu.bggId !== entry.bggId) {
    return { slug, ok: false, message: `Mismatch bggId : JSON ${jeu.bggId} vs seed ${entry.bggId}` };
  }

  const pdfPath = path.join(PDF_DIR, `${slug}.pdf`);
  let bytes: number;
  if (existsSync(pdfPath) && !options.force) {
    const st = await stat(pdfPath);
    bytes = st.size;
  } else {
    const headInfo = await head(entry.pdfUrl);
    if (!headInfo.ok) {
      return { slug, ok: false, message: `HEAD HTTP ${headInfo.status} sur ${entry.pdfUrl}` };
    }
    bytes = await downloadPdf(entry.pdfUrl, pdfPath);
  }

  jeu.pdfUrlSource = entry.pdfUrl;
  jeu.pdfLocal = `/jeux/pdf/${slug}.pdf`;
  jeu.pdfSourcePage = entry.sourcePage ?? null;
  jeu.pdfLangue = entry.langue ?? null;
  jeu.pdfEditeurAffiche = entry.editeurAffiche ?? null;
  jeu.pdfNote = entry.note ?? null;
  jeu.pdfServingMode = "local";
  jeu.pdfTailleOctets = bytes;
  jeu.pdfDateRecuperation = new Date().toISOString();

  await writeFile(jeuPath, JSON.stringify(jeu, null, 2) + "\n", "utf8");
  return { slug, ok: true, message: "OK", bytes };
}

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

async function main(): Promise<void> {
  loadEnvLocal(ROOT);
  await mkdir(PDF_DIR, { recursive: true });

  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const filtered = args.filter((a) => !a.startsWith("--"));

  const seed = await loadSeed();
  const allSlugs = Object.keys(seed.urls);
  const slugs = filtered.length > 0 ? filtered : allSlugs;

  if (slugs.length === 0) {
    console.error(
      `Aucun jeu à traiter. Seed vide ? Édite ${path.relative(ROOT, SEED_FILE)} pour y ajouter des entrées.`,
    );
    process.exit(1);
  }

  console.log(`fetch-pdf : ${slugs.length} jeu(x) à traiter${force ? " (--force)" : ""}.\n`);
  const results: FetchResult[] = [];
  for (const slug of slugs) {
    const entry = seed.urls[slug];
    if (!entry) {
      results.push({ slug, ok: false, message: "Slug absent du seed" });
      console.log(`✗ ${slug} : slug absent du seed urls-pdf.json`);
      continue;
    }
    process.stdout.write(`→ ${slug} … `);
    try {
      const r = await processOne(slug, entry, { force });
      results.push(r);
      if (r.ok) {
        console.log(`OK (${((r.bytes ?? 0) / 1024).toFixed(0)} KB)`);
      } else {
        console.log(`KO — ${r.message}`);
      }
    } catch (err) {
      const msg = (err as Error).message;
      results.push({ slug, ok: false, message: msg });
      console.log(`KO — ${msg}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  const ok = results.filter((r) => r.ok).length;
  const ko = results.length - ok;
  console.log(`\nTerminé : ${ok} ok, ${ko} échec(s).`);
  if (ko > 0) {
    console.log(`\nÉchecs :`);
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  - ${r.slug} : ${r.message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
