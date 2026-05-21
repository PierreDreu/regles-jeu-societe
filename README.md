# regles-jeu-societe.fr

> Annuaire et règles de jeux de société, rédigés en français.

**regles-jeu-societe.fr** est un site web francophone consacré aux jeux de société modernes : un annuaire avec une fiche par jeu (joueurs, durée, âge, éditeur, mécaniques) accompagnée d'une explication claire des règles en français, et un blog éditorial autour (top 10, comparatifs, sorties, tutos).

Le site est en cours de construction. Ce dépôt contient les scripts d'aspiration des métadonnées et l'outillage de constitution du corpus de contenu.

---

## Statut

- ✅ Bootstrap technique (Node 22 + TypeScript)
- ✅ Fetcher BoardGameGeek (`/xmlapi2/thing`) avec rate limiting, retries sur 202, parsing XML
- ⏳ Inscription auprès de la BGG XML API (token bearer requis depuis juillet 2025)
- ⏳ Constitution des listes cibles (Top BGG, nouveautés 2024–2026, éditions francophones)
- ⏳ Aspiration des métadonnées et des PDF de règles officiels (usage interne, source pour rédaction)
- ⏳ Rédaction des fiches en français (assistance IA + relecture humaine systématique)
- ⏳ Front Next.js + base PostgreSQL
- ⏳ Mise en ligne (hébergement français — OVH)

---

## Architecture prévue

| Couche | Choix |
|---|---|
| Front | Next.js 15 (App Router), TypeScript, Tailwind CSS |
| Base de données | PostgreSQL + Prisma |
| Contenu blog | MDX |
| Hébergement | OVH (Docker), pas de dépendance Vercel-only |
| Sources métadonnées | BoardGameGeek XML API v2 (avec inscription) |
| Sources règles | PDF officiels des éditeurs (usage interne pour rédaction IA assistée), reformulation systématique en français |

---

## Données et droit d'auteur

- Les **métadonnées factuelles** (auteur, éditeur, année, joueurs, durée, mécaniques, catégories) sont récupérées via l'API BGG conformément à ses *Terms of Use*, avec **attribution et lien retour** vers la fiche BGG correspondante sur chaque page jeu du site.
- Les **textes de règles** publiés sur le site sont rédigés **en français et en propre** par l'équipe éditoriale. Aucun copier-coller des PDF éditeurs ni des descriptions BGG. Les PDF officiels servent uniquement de référence interne pour éviter les erreurs et hallucinations.
- Aucune republication automatique de contenu BGG (descriptions longues, avis utilisateurs, classements internes) en dehors des données purement factuelles.

---

## Structure du dépôt

```
.
├── scripts/                 # Outillage d'aspiration et de génération
│   ├── lib/
│   │   ├── bgg.ts           # Client BGG XML API v2 (token bearer, retries)
│   │   └── slug.ts          # Slugs URL propres
│   └── fetch-bgg.ts         # CLI d'aspiration des métadonnées
├── data/
│   ├── jeux/                # Une fiche JSON par jeu
│   ├── listes/              # Listes de BGG IDs cibles
│   └── taxonomies/          # Catégories et mécaniques avec mapping FR
├── package.json
└── tsconfig.json
```

---

## Usage local

```bash
# Installer les dépendances
npm install

# Copier .env.example en .env.local et y placer le token BGG
cp .env.example .env.local

# Aspirer un ou plusieurs jeux (par BGG ID)
npm run fetch:bgg -- 13 9209 39856
```

---

## Contact

Projet personnel maintenu par Pierre Dreulle — `pierredreulle@gmail.com`.
