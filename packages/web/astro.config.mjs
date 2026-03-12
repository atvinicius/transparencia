import { defineConfig } from "astro/config";
import tailwindcss from "@astrojs/tailwind";

export default defineConfig({
  integrations: [
    tailwindcss({
      applyBaseStyles: false,
    }),
  ],
  site: "https://atvinicius.github.io",
  base: "/transparencia",
});
