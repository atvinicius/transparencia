import { defineConfig } from "astro/config";
import tailwindcss from "@astrojs/tailwind";

export default defineConfig({
  integrations: [
    tailwindcss({
      applyBaseStyles: false,
    }),
  ],
  site: "https://transparencia.github.io",
});
