import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBggThing, type BggGameRaw } from "./lib/bgg.js";
import { toSlug } from "./lib/slug.js";

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const JEUX_DIR = path.join(ROOT, "data", "jeux");
const IMAGES_DIR = path.join(JEUX_DIR, "images");
const OVERRIDES_FILE = path.join(ROOT, "data", "overrides", "noms-jeux.json");

interface JeuJson {
  slug: string;
  bggId: number;
  nom: string;
  nomOriginal: string | null;
  anneeSortie: number | null;
  joueursMin: number | null;
  joueursMax: number | null;
  joueursRecommandes: number[];
  dureeMin: number | null;
  dureeMax: number | null;
  ageMin: number | null;
  poidsRegles: number | null;
  designers: string[];
  artistes: string[];
  editeurs: string[];
  editeurFrancophone: string | null;
  categoriesBGG: { id: number; value: string }[];
  mecaniquesBGG: { id: number; value: string }[];
  famillesBGG: { id: number; value: string }[];
  bggRank: number | null;
  bggRating: number | null;
  image: string | null;
  imageUrlSource: string | null;
  pdfUrlSource: string | null;
  descriptionEN: string;
  presentation: string | null;
  materiel: string[] | null;
  miseEnPlace: string | null;
  deroulement: string | null;
  finDePartie: string | null;
  variantes: string | null;
  astuces: string | null;
  relueParHumain: boolean;
  dateImportBGG: string;
  dateGeneration: string | null;
  dateRelecture: string | null;
}

const EDITEURS_FRANCOPHONES_CANONICAL: Record<string, string> = {
  asmodee: "Asmodee",
  iello: "Iello",
  "days of wonder": "Days of Wonder",
  "repos production": "Repos Production",
  "space cowboys": "Space Cowboys",
  "catch up games": "Catch Up Games",
  "studio h": "Studio H",
  libellud: "Libellud",
  bombyx: "Bombyx",
  "blam!": "Blam!",
  "blue cocker games": "Blue Cocker Games",
  "cocktail games": "Cocktail Games",
  "don't panic games": "Don't Panic Games",
  "édition du matagot": "Édition du Matagot",
  matagot: "Matagot",
  funforge: "Funforge",
  gigamic: "Gigamic",
  hurrican: "Hurrican",
  "la boîte de jeu": "La Boîte de Jeu",
  "lui-même": "Lui-même",
  "lumberjacks studio": "Lumberjacks Studio",
  origames: "Origames",
  oya: "Oya",
  "pixie games": "Pixie Games",
  "sit down!": "Sit Down!",
  "sweet games": "Sweet Games",
  sylex: "Sylex",
  "tiki editions": "Tiki Editions",
  ystari: "Ystari Games",
  "ystari games": "Ystari Games",
  "ferti games": "Ferti Games",
  "haba": "HABA",
  "purple brain creations": "Purple Brain Creations",
};

function pickEditeurFrancophone(editeurs: string[]): string | null {
  for (const ed of editeurs) {
    const canon = EDITEURS_FRANCOPHONES_CANONICAL[ed.toLowerCase().trim()];
    if (canon) return canon;
  }
  return null;
}

const OVERRIDES_NOMS: Record<string, string> = {};
const FR_LIST_FILE = path.join(ROOT, "data", "listes", "edition-francaise.json");

function loadOverrides(): void {
  if (existsSync(OVERRIDES_FILE)) {
    try {
      const raw = JSON.parse(readFileSync(OVERRIDES_FILE, "utf8")) as { overrides?: Record<string, string> };
      Object.assign(OVERRIDES_NOMS, raw.overrides ?? {});
    } catch (err) {
      console.warn(`⚠️  ${OVERRIDES_FILE} : ${(err as Error).message}`);
    }
  }
  if (existsSync(FR_LIST_FILE)) {
    try {
      const raw = JSON.parse(readFileSync(FR_LIST_FILE, "utf8")) as {
        jeux?: Array<{ bggId: number; nomFrancais?: string }>;
      };
      for (const j of raw.jeux ?? []) {
        if (j.nomFrancais && !OVERRIDES_NOMS[String(j.bggId)]) {
          OVERRIDES_NOMS[String(j.bggId)] = j.nomFrancais;
        }
      }
    } catch (err) {
      console.warn(`⚠️  ${FR_LIST_FILE} : ${(err as Error).message}`);
    }
  }
}

const FRENCH_WORD_RE =
  /\b(le|la|les|l'|un|une|du|des|de|au|aux|et|ou|avec|sans|pour|dans|sur|par|chez|jeu|jeux|cartes?|dés?|royaume|île|loups|garous|seigneur|aventur(?:e|iers?)|détective|petits?|grands?|nouveau|nouvelle|version|édition)\b/i;
const FRENCH_ONLY_CHARS_RE = /[œæ]/i;

function pickFrenchName(bggId: number, primary: string, alternates: string[]): string {
  const override = OVERRIDES_NOMS[String(bggId)];
  if (override) return override;

  for (const alt of alternates) {
    if (FRENCH_WORD_RE.test(alt) || FRENCH_ONLY_CHARS_RE.test(alt)) return alt;
  }
  return primary;
}

async function downloadImage(url: string, slug: string): Promise<string | null> {
  const ext = url.match(/\.(jpe?g|png|webp)(\?|$)/i)?.[1]?.toLowerCase() ?? "jpg";
  const filename = `${slug}.${ext === "jpeg" ? "jpg" : ext}`;
  const target = path.join(IMAGES_DIR, filename);
  if (existsSync(target)) {
    return `/jeux/images/${filename}`;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(target, buf);
    return `/jeux/images/${filename}`;
  } catch {
    return null;
  }
}

function toJeuJson(raw: BggGameRaw): JeuJson {
  const nom = pickFrenchName(raw.bggId, raw.nomPrimaire, raw.nomsAlternatifs);
  const nomOriginal = nom === raw.nomPrimaire ? null : raw.nomPrimaire;
  const slug = toSlug(nom);
  return {
    slug,
    bggId: raw.bggId,
    nom,
    nomOriginal,
    anneeSortie: raw.anneeSortie,
    joueursMin: raw.joueursMin,
    joueursMax: raw.joueursMax,
    joueursRecommandes: raw.joueursRecommandes,
    dureeMin: raw.dureeMin,
    dureeMax: raw.dureeMax ?? raw.dureePlayingTime,
    ageMin: raw.ageMin,
    poidsRegles: raw.poidsRegles,
    designers: raw.designers,
    artistes: raw.artistes,
    editeurs: raw.editeurs,
    editeurFrancophone: pickEditeurFrancophone(raw.editeurs),
    categoriesBGG: raw.categories,
    mecaniquesBGG: raw.mecaniques,
    famillesBGG: raw.familles,
    bggRank: raw.bggRank,
    bggRating: raw.bggRating,
    image: null,
    imageUrlSource: raw.imageUrl,
    pdfUrlSource: null,
    descriptionEN: raw.descriptionEN,
    presentation: null,
    materiel: null,
    miseEnPlace: null,
    deroulement: null,
    finDePartie: null,
    variantes: null,
    astuces: null,
    relueParHumain: false,
    dateImportBGG: new Date().toISOString(),
    dateGeneration: null,
    dateRelecture: null,
  };
}

async function fetchOne(bggId: number, options: { downloadImage?: boolean }): Promise<JeuJson> {
  process.stdout.write(`→ BGG ${bggId} …`);
  const raw = await fetchBggThing(bggId);
  const jeu = toJeuJson(raw);
  if (options.downloadImage && raw.imageUrl) {
    const local = await downloadImage(raw.imageUrl, jeu.slug);
    jeu.image = local;
  }
  const target = path.join(JEUX_DIR, `${jeu.slug}.json`);
  await writeFile(target, JSON.stringify(jeu, null, 2) + "\n", "utf8");
  process.stdout.write(` ${jeu.nom} → ${path.relative(ROOT, target)}\n`);
  return jeu;
}

async function readIds(listPath: string): Promise<number[]> {
  const content = await readFile(listPath, "utf8");
  const parsed = JSON.parse(content);
  const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.jeux) ? parsed.jeux : null;
  if (!items) {
    throw new Error(`List file ${listPath} must contain a JSON array or an object with a "jeux" array`);
  }
  return items
    .map((x: unknown) =>
      typeof x === "number" ? x : typeof x === "object" && x !== null ? Number((x as { bggId?: unknown }).bggId) : NaN,
    )
    .filter((n: number) => Number.isFinite(n));
}

async function main(): Promise<void> {
  loadEnvLocal(ROOT);
  loadOverrides();
  await mkdir(JEUX_DIR, { recursive: true });
  await mkdir(IMAGES_DIR, { recursive: true });

  const args = process.argv.slice(2);
  const noImage = args.includes("--no-image");
  const filtered = args.filter((a) => !a.startsWith("--"));

  let ids: number[] = [];
  if (filtered.length === 0) {
    console.error("Usage: tsx scripts/fetch-bgg.ts <bggId|listFile> [...] [--no-image]");
    process.exit(1);
  }
  for (const a of filtered) {
    if (/^\d+$/.test(a)) {
      ids.push(Number(a));
    } else {
      const fromList = await readIds(path.resolve(a));
      ids.push(...fromList);
    }
  }
  ids = [...new Set(ids)];

  console.log(`Fetching ${ids.length} jeu(x) depuis BGG…\n`);
  let ok = 0;
  let ko = 0;
  for (const id of ids) {
    try {
      await fetchOne(id, { downloadImage: !noImage });
      ok++;
    } catch (err) {
      ko++;
      console.error(`  ✗ BGG ${id} : ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  console.log(`\nTermine: ${ok} ok, ${ko} échec(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
