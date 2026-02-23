import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["node_modules/**"],
    server: {
      deps: {
        inline: ["zod"],
      },
    },
  },
});
