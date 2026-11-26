import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// GitHub Pages serves static files only, so /login needs its own index.html.
const ownerLoginPage = () => ({
  name: "owner-login-page",
  closeBundle() {
    const out = resolve("dist");
    mkdirSync(resolve(out, "login"), { recursive: true });
    copyFileSync(resolve(out, "index.html"), resolve(out, "login/index.html"));
  },
});

export default defineConfig({ plugins: [ownerLoginPage()] });
