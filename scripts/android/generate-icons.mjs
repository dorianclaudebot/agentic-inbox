/**
 * Rasterize public/favicon.svg to PWA/TWA PNG icons.
 *
 *   node scripts/android/generate-icons.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const svg = readFileSync(join(root, "public/favicon.svg"));

function writeIcon(size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    background: "rgba(255,255,255,1)",
  });
  const png = resvg.render().asPng();
  const out = join(root, "public", `icon-${size}.png`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);
  console.log(`wrote ${out} (${png.length} bytes)`);
}

writeIcon(192);
writeIcon(512);
