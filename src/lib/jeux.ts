import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const JEUX_DIR = path.resolve(process.cwd(), "data/jeux");

export interface Jeu {
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
  descriptionEN: string;
  pdfUrlSource?: string | null;
  pdfLocal?: string | null;
  pdfSourcePage?: string | null;
  pdfLangue?: string | null;
  pdfEditeurAffiche?: string | null;
  pdfNote?: string | null;
  pdfServingMode?: "local" | "redirect" | "unavailable" | null;
  pdfTailleOctets?: number | null;
  pdfDateRecuperation?: string | null;
}

let CACHE: Jeu[] | null = null;

export function loadJeux(): Jeu[] {
  if (CACHE) return CACHE;
  const files = readdirSync(JEUX_DIR).filter((f) => f.endsWith(".json"));
  const jeux: Jeu[] = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(path.join(JEUX_DIR, f), "utf8")) as Jeu;
      jeux.push(raw);
    } catch (err) {
      console.warn(`[lib/jeux] Ignoré ${f} : ${(err as Error).message}`);
    }
  }
  jeux.sort((a, b) => {
    const ra = a.bggRank ?? Number.POSITIVE_INFINITY;
    const rb = b.bggRank ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return a.nom.localeCompare(b.nom, "fr");
  });
  CACHE = jeux;
  return jeux;
}

export function findJeu(slug: string): Jeu | undefined {
  return loadJeux().find((j) => j.slug === slug);
}

export function formatJoueurs(j: Jeu): string {
  if (j.joueursMin === null && j.joueursMax === null) return "—";
  if (j.joueursMin === j.joueursMax) return `${j.joueursMin}`;
  return `${j.joueursMin ?? "?"}–${j.joueursMax ?? "?"}`;
}

export function formatDuree(j: Jeu): string {
  const min = j.dureeMin;
  const max = j.dureeMax;
  if (min === null && max === null) return "—";
  if (min === max) return `${min} min`;
  return `${min ?? "?"}–${max ?? "?"} min`;
}

export function formatComplexite(p: number | null): string {
  if (p === null) return "—";
  if (p < 1.5) return "Très facile";
  if (p < 2.25) return "Facile";
  if (p < 3) return "Moyen";
  if (p < 3.75) return "Expert";
  return "Très expert";
}

export function uniqueCategories(jeux: Jeu[]): string[] {
  const set = new Set<string>();
  for (const j of jeux) for (const c of j.categoriesBGG) set.add(c.value);
  return [...set].sort((a, b) => a.localeCompare(b, "fr"));
}

export function uniqueMecaniques(jeux: Jeu[]): string[] {
  const set = new Set<string>();
  for (const j of jeux) for (const m of j.mecaniquesBGG) set.add(m.value);
  return [...set].sort((a, b) => a.localeCompare(b, "fr"));
}
