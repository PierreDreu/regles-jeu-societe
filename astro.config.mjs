import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  site: "https://regles-jeu-societe.fr",
  output: "static",
  build: {
    format: "directory",
  },
  trailingSlash: "ignore",
});
