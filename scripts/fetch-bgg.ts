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

const EDITEURS_FRANCOPHONES = new Set([
  "Asmodee",
  "Iello",
  "Days of Wonder",
  "Repos Production",
  "Space Cowboys",
  "Catch Up Games",
  "Studio H",
  "Libellud",
  "Bombyx",
  "Blam!",
  "Blue Cocker Games",
  "Cocktail Games",
  "Don't Panic Games",
  "Édition du Matagot",
  "Matagot",
  "Funforge",
  "Gigamic",
  "Hurrican",
  "La Boîte de Jeu",
  "Lui-même",
  "Lumberjacks Studio",
  "Origames",
  "Oya",
  "Pixie Games",
  "Sit Down!",
  "Sweet Games",
  "Sylex",
  "Tiki Editions",
]);

function pickEditeurFrancophone(editeurs: string[]): string | null {
  for (const ed of editeurs) {
    if (EDITEURS_FRANCOPHONES.has(ed)) return ed;
  }
  return null;
}

function pickFrenchName(primary: string, alternates: string[]): string {
  const frenchHints = [
    /^L(?:es?|a)\s+/i,
    /^Un[e]?\s+/i,
    /[àâäçéèêëîïôöùûüÿœæ]/i,
  ];
  for (const alt of alternates) {
    if (frenchHints.some((re) => re.test(alt))) return alt;
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
  const nom = pickFrenchName(raw.nomPrimaire, raw.nomsAlternatifs);
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
  if (Array.isArray(parsed)) {
    return parsed
      .map((x) => (typeof x === "number" ? x : typeof x === "object" && x !== null ? Number((x as { bggId?: unknown }).bggId) : NaN))
      .filter((n) => Number.isFinite(n));
  }
  throw new Error(`List file ${listPath} must contain a JSON array`);
}

async function main(): Promise<void> {
  loadEnvLocal(ROOT);
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
