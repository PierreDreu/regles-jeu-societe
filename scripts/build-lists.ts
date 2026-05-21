import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SOURCE_DIR = path.join(ROOT, "data", "source");
const SEEDS_DIR = path.join(ROOT, "data", "seeds");
const LISTES_DIR = path.join(ROOT, "data", "listes");

const CSV_PATH = path.join(SOURCE_DIR, "boardgames_ranks.csv");
const SEED_PATH = path.join(SEEDS_DIR, "incontournables-francophones.json");

const TOP_BGG_LIMIT = 500;
const NOUVEAUTES_MIN_YEAR = 2024;
const NOUVEAUTES_MAX_YEAR = 2026;
const NOUVEAUTES_MIN_USERS = 200;
const FR_MIN_USERS = 100;

interface CsvRow {
  id: number;
  name: string;
  yearpublished: number | null;
  rank: number | null;
  bayesaverage: number | null;
  average: number | null;
  usersrated: number;
  isExpansion: boolean;
}

interface SeedEntry {
  nom: string;
  noms: string[];
  axe: string;
}

interface SeedFile {
  jeux: SeedEntry[];
}

interface MasterEntry {
  bggId: number;
  nom: string;
  axes: string[];
  bggRank: number | null;
  anneeSortie: number | null;
  sources: string[];
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

async function loadCsv(csvPath: string): Promise<CsvRow[]> {
  const content = await readFile(csvPath, "utf8");
  const lines = content.split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV vide ou invalide");
  const header = parseCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const idx = (col: string) => {
    const i = header.indexOf(col);
    if (i === -1) throw new Error(`Colonne CSV manquante : ${col}`);
    return i;
  };
  const idIdx = idx("id");
  const nameIdx = idx("name");
  const yearIdx = idx("yearpublished");
  const rankIdx = idx("rank");
  const bayesIdx = idx("bayesaverage");
  const avgIdx = idx("average");
  const usersIdx = idx("usersrated");
  const expIdx = idx("is_expansion");

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cells = parseCsvLine(line);
    if (cells.length < header.length) continue;
    const id = Number(cells[idIdx]);
    if (!Number.isFinite(id)) continue;
    const rankRaw = cells[rankIdx];
    const rank = rankRaw && rankRaw !== "0" && rankRaw !== "" ? Number(rankRaw) : null;
    rows.push({
      id,
      name: (cells[nameIdx] ?? "").trim(),
      yearpublished: cells[yearIdx] ? Number(cells[yearIdx]) : null,
      rank: rank && Number.isFinite(rank) ? rank : null,
      bayesaverage: cells[bayesIdx] ? Number(cells[bayesIdx]) : null,
      average: cells[avgIdx] ? Number(cells[avgIdx]) : null,
      usersrated: cells[usersIdx] ? Number(cells[usersIdx]) : 0,
      isExpansion: cells[expIdx] === "1",
    });
  }
  return rows;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function resolveSeedFromCsv(seed: SeedFile, rows: CsvRow[]): { entry: SeedEntry; row: CsvRow | null }[] {
  const byName = new Map<string, CsvRow[]>();
  for (const r of rows) {
    if (r.isExpansion) continue;
    const key = normalizeName(r.name);
    const arr = byName.get(key);
    if (arr) arr.push(r);
    else byName.set(key, [r]);
  }
  const pickBest = (candidates: CsvRow[]): CsvRow => {
    return [...candidates].sort((a, b) => {
      const ra = a.rank ?? Infinity;
      const rb = b.rank ?? Infinity;
      if (ra !== rb) return ra - rb;
      return b.usersrated - a.usersrated;
    })[0]!;
  };

  return seed.jeux.map((entry) => {
    for (const candidate of entry.noms) {
      const key = normalizeName(candidate);
      const hits = byName.get(key);
      if (hits && hits.length > 0) {
        return { entry, row: pickBest(hits) };
      }
    }
    return { entry, row: null };
  });
}

function buildTopBgg(rows: CsvRow[]): CsvRow[] {
  return rows
    .filter((r) => !r.isExpansion && r.rank !== null)
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))
    .slice(0, TOP_BGG_LIMIT);
}

function buildNouveautes(rows: CsvRow[]): CsvRow[] {
  return rows
    .filter(
      (r) =>
        !r.isExpansion &&
        r.yearpublished !== null &&
        r.yearpublished >= NOUVEAUTES_MIN_YEAR &&
        r.yearpublished <= NOUVEAUTES_MAX_YEAR &&
        r.usersrated >= NOUVEAUTES_MIN_USERS,
    )
    .sort((a, b) => {
      const ra = a.rank ?? Infinity;
      const rb = b.rank ?? Infinity;
      if (ra !== rb) return ra - rb;
      return b.usersrated - a.usersrated;
    });
}

interface ListItem {
  bggId: number;
  nom: string;
  anneeSortie: number | null;
  bggRank: number | null;
  axes?: string[];
}

function rowToItem(r: CsvRow, axes?: string[]): ListItem {
  return { bggId: r.id, nom: r.name, anneeSortie: r.yearpublished, bggRank: r.rank, ...(axes ? { axes } : {}) };
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

function explainMissingCsv(): never {
  console.error(`
==========================================================
  CSV BoardGameGeek manquant : ${path.relative(ROOT, CSV_PATH)}

  Action manuelle nécessaire (~30 secondes) :
   1. Connecte-toi sur https://boardgamegeek.com
   2. Va sur https://boardgamegeek.com/data_dumps/bg_ranks
   3. Clique "Click to Download" — fichier ZIP "boardgames_ranks.zip"
   4. Dézippe, copie "boardgames_ranks.csv" dans :
      ${path.relative(ROOT, CSV_PATH)}
   5. Relance : npm run build:lists
==========================================================
`);
  process.exit(2);
}

async function main(): Promise<void> {
  await ensureDir(LISTES_DIR);

  if (!existsSync(CSV_PATH)) explainMissingCsv();

  console.log(`→ Chargement du CSV BGG depuis ${path.relative(ROOT, CSV_PATH)}…`);
  const rows = await loadCsv(CSV_PATH);
  console.log(`  ${rows.length} entrées chargées.`);

  console.log(`→ Chargement du seed depuis ${path.relative(ROOT, SEED_PATH)}…`);
  const seedRaw = JSON.parse(await readFile(SEED_PATH, "utf8")) as SeedFile;
  console.log(`  ${seedRaw.jeux.length} entrées au seed.`);

  const resolved = resolveSeedFromCsv(seedRaw, rows);
  const matched = resolved.filter((r) => r.row);
  const missed = resolved.filter((r) => !r.row);
  console.log(`  Résolution : ${matched.length} appariés, ${missed.length} non trouvés.`);
  if (missed.length > 0) {
    console.log(`  Non trouvés (à vérifier manuellement) :`);
    for (const m of missed) console.log(`    - ${m.entry.nom} (${m.entry.noms.join(" / ")})`);
  }

  const topBgg = buildTopBgg(rows).map((r) => rowToItem(r));
  const nouveautes = buildNouveautes(rows).map((r) => rowToItem(r));
  const francophones: ListItem[] = matched.map((m) => rowToItem(m.row!, [m.entry.axe]));

  await writeFile(
    path.join(LISTES_DIR, "top-bgg.json"),
    JSON.stringify({ _description: `Top ${TOP_BGG_LIMIT} BGG (issu du CSV bg_ranks)`, jeux: topBgg }, null, 2) + "\n",
    "utf8",
  );
  await writeFile(
    path.join(LISTES_DIR, "nouveautes-2024-2026.json"),
    JSON.stringify(
      {
        _description: `Nouveautés ${NOUVEAUTES_MIN_YEAR}-${NOUVEAUTES_MAX_YEAR} avec ≥ ${NOUVEAUTES_MIN_USERS} votes`,
        jeux: nouveautes,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await writeFile(
    path.join(LISTES_DIR, "edition-francaise.json"),
    JSON.stringify(
      { _description: "Incontournables francophones (seed manuel résolu via le CSV BGG)", jeux: francophones },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const masterMap = new Map<number, MasterEntry>();
  const addToMaster = (items: ListItem[], source: string) => {
    for (const it of items) {
      const existing = masterMap.get(it.bggId);
      if (existing) {
        if (!existing.sources.includes(source)) existing.sources.push(source);
        if (it.axes) {
          for (const a of it.axes) if (!existing.axes.includes(a)) existing.axes.push(a);
        }
      } else {
        masterMap.set(it.bggId, {
          bggId: it.bggId,
          nom: it.nom,
          axes: it.axes ?? [],
          bggRank: it.bggRank,
          anneeSortie: it.anneeSortie,
          sources: [source],
        });
      }
    }
  };
  addToMaster(topBgg, "top-bgg");
  addToMaster(nouveautes, "nouveautes-2024-2026");
  addToMaster(francophones, "edition-francaise");

  const master = [...masterMap.values()].sort((a, b) => {
    const ra = a.bggRank ?? Infinity;
    const rb = b.bggRank ?? Infinity;
    return ra - rb;
  });
  await writeFile(
    path.join(LISTES_DIR, "master.json"),
    JSON.stringify(
      { _description: "Liste maître déduppliquée des 3 axes (top-bgg + nouveautés + francophones)", jeux: master },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(`
Listes générées :
  - top-bgg.json              ${topBgg.length} jeux
  - nouveautes-2024-2026.json ${nouveautes.length} jeux
  - edition-francaise.json    ${francophones.length} jeux
  - master.json               ${master.length} jeux uniques
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
