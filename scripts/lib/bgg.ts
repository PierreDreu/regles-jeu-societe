import { XMLParser } from "fast-xml-parser";

const BGG_API = "https://boardgamegeek.com/xmlapi2";

export interface BggGameRaw {
  bggId: number;
  type: string;
  nomPrimaire: string;
  nomsAlternatifs: string[];
  anneeSortie: number | null;
  joueursMin: number | null;
  joueursMax: number | null;
  joueursRecommandes: number[];
  dureeMin: number | null;
  dureeMax: number | null;
  dureePlayingTime: number | null;
  ageMin: number | null;
  poidsRegles: number | null;
  designers: string[];
  artistes: string[];
  editeurs: string[];
  categories: { id: number; value: string }[];
  mecaniques: { id: number; value: string }[];
  familles: { id: number; value: string }[];
  bggRank: number | null;
  bggRating: number | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  descriptionEN: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseAttributeValue: true,
  parseTagValue: true,
  isArray: (name) => ["name", "link", "poll", "result", "results"].includes(name),
});

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function decodeEntities(raw: string): string {
  return raw
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseDescription(raw: string | undefined): string {
  if (!raw) return "";
  return decodeEntities(raw);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchBggThing(bggId: number, options: { retries?: number } = {}): Promise<BggGameRaw> {
  const retries = options.retries ?? 8;
  const url = `${BGG_API}/thing?id=${bggId}&stats=1`;

  const token = process.env.BGG_API_TOKEN;
  if (!token) {
    throw new Error(
      "BGG_API_TOKEN manquant. Depuis juillet 2025, l'API XML de BGG exige une inscription. " +
        "Voir https://boardgamegeek.com/using_the_xml_api puis renseigner BGG_API_TOKEN dans .env.local",
    );
  }
  const headers: Record<string, string> = {
    "User-Agent": "regles-jeu-societe.fr/0.1 (contact: pierredreulle@gmail.com)",
    Authorization: `Bearer ${token}`,
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url, { headers });

    if (res.status === 200) {
      const xml = await res.text();
      return parseThingXml(xml, bggId);
    }
    if (res.status === 202) {
      const waitMs = Math.min(1500 * attempt, 8000);
      await sleep(waitMs);
      continue;
    }
    if (res.status === 429) {
      await sleep(5000 * attempt);
      continue;
    }
    throw new Error(`BGG API ${url} returned ${res.status}`);
  }
  throw new Error(`BGG API ${url} did not become ready after ${retries} retries`);
}

function parseThingXml(xml: string, expectedId: number): BggGameRaw {
  const doc = parser.parse(xml);
  const item = doc?.items?.item;
  if (!item) throw new Error(`No <item> in BGG response for id ${expectedId}`);

  const names = asArray<{ "@_type": string; "@_value": string }>(item.name);
  const primary = decodeEntities(names.find((n) => n["@_type"] === "primary")?.["@_value"] ?? "");
  const alternates = names.filter((n) => n["@_type"] === "alternate").map((n) => decodeEntities(n["@_value"]));

  const links = asArray<{ "@_type": string; "@_id": number; "@_value": string }>(item.link);
  const filterLinks = (type: string) => links.filter((l) => l["@_type"] === type);
  const linkValues = (type: string) => filterLinks(type).map((l) => l["@_value"]);
  const linkPairs = (type: string) =>
    filterLinks(type).map((l) => ({ id: Number(l["@_id"]), value: l["@_value"] }));

  const minP = item.minplayers?.["@_value"];
  const maxP = item.maxplayers?.["@_value"];
  const minTime = item.minplaytime?.["@_value"];
  const maxTime = item.maxplaytime?.["@_value"];
  const playingTime = item.playingtime?.["@_value"];
  const minAge = item.minage?.["@_value"];
  const yearpublished = item.yearpublished?.["@_value"];

  const stats = item.statistics?.ratings;
  const avg = stats?.average?.["@_value"];
  const rankNodes = asArray<{ "@_name": string; "@_value": string | number }>(stats?.ranks?.rank);
  const overall = rankNodes.find((r) => r["@_name"] === "boardgame");
  const rankRaw = overall?.["@_value"];
  const bggRank = rankRaw === "Not Ranked" || rankRaw === undefined ? null : Number(rankRaw);
  const weight = stats?.averageweight?.["@_value"];

  const polls = asArray<{ "@_name": string; results?: unknown }>(item.poll);
  const playersPoll = polls.find((p) => p["@_name"] === "suggested_numplayers");
  const recommended: number[] = [];
  if (playersPoll && Array.isArray(playersPoll.results)) {
    for (const r of playersPoll.results as { "@_numplayers": string; result?: unknown }[]) {
      const results = asArray<{ "@_value": string; "@_numvotes": number }>(r.result);
      const best = results.find((x) => x["@_value"] === "Best");
      const rec = results.find((x) => x["@_value"] === "Recommended");
      const notRec = results.find((x) => x["@_value"] === "Not Recommended");
      const bv = Number(best?.["@_numvotes"] ?? 0);
      const rv = Number(rec?.["@_numvotes"] ?? 0);
      const nv = Number(notRec?.["@_numvotes"] ?? 0);
      if (bv + rv > nv && bv + rv > 0) {
        const np = r["@_numplayers"];
        const n = Number(np);
        if (!Number.isNaN(n)) recommended.push(n);
      }
    }
  }

  return {
    bggId: Number(item["@_id"] ?? expectedId),
    type: String(item["@_type"] ?? "boardgame"),
    nomPrimaire: primary,
    nomsAlternatifs: alternates,
    anneeSortie: yearpublished !== undefined ? Number(yearpublished) : null,
    joueursMin: minP !== undefined ? Number(minP) : null,
    joueursMax: maxP !== undefined ? Number(maxP) : null,
    joueursRecommandes: recommended,
    dureeMin: minTime !== undefined ? Number(minTime) : null,
    dureeMax: maxTime !== undefined ? Number(maxTime) : null,
    dureePlayingTime: playingTime !== undefined ? Number(playingTime) : null,
    ageMin: minAge !== undefined ? Number(minAge) : null,
    poidsRegles: weight !== undefined ? Number(weight) : null,
    designers: linkValues("boardgamedesigner"),
    artistes: linkValues("boardgameartist"),
    editeurs: linkValues("boardgamepublisher"),
    categories: linkPairs("boardgamecategory"),
    mecaniques: linkPairs("boardgamemechanic"),
    familles: linkPairs("boardgamefamily"),
    bggRank,
    bggRating: avg !== undefined ? Number(avg) : null,
    imageUrl: item.image ? String(item.image) : null,
    thumbnailUrl: item.thumbnail ? String(item.thumbnail) : null,
    descriptionEN: parseDescription(item.description ? String(item.description) : ""),
  };
}
