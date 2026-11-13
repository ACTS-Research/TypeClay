import { defineConfig } from "vite";

// One app, four pages. Each prototype is its own entry so it stays self-contained.
const page = (p: string) => new URL(p, import.meta.url).pathname;

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: page("./index.html"),
        a: page("./a/index.html"),
        b: page("./b/index.html"),
        c: page("./c/index.html"),
      },
    },
  },
});
