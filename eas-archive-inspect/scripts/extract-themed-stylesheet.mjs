/**
 * Usage: node scripts/extract-themed-stylesheet.mjs <src.tsx> <out.ts> <exportFnName> [--strip]
 * Extracts first `const styles = StyleSheet.create({ ... });` → createThemed stylesheet.
 */
import fs from "fs";

const args = process.argv.slice(2);
const strip = args.includes("--strip");
const posArgs = args.filter((a) => a !== "--strip");
const [srcPath, outPath, exportFnName] = posArgs;
if (!srcPath || !outPath || !exportFnName) {
  console.error("Usage: node extract-themed-stylesheet.mjs <src> <out> <exportFnName> [--strip]");
  process.exit(1);
}

const MARKER = "const styles = StyleSheet.create({";
const t = fs.readFileSync(srcPath, "utf8");
const start = t.indexOf(MARKER);
if (start < 0) {
  console.error("No", MARKER, "in", srcPath);
  process.exit(1);
}
const braceOpen = start + MARKER.length - 1;
let depth = 0;
let i = braceOpen;
for (; i < t.length; i++) {
  const c = t[i];
  if (c === "{") depth++;
  else if (c === "}") {
    depth--;
    if (depth === 0) {
      i++;
      break;
    }
  }
}
const after = t.slice(i).trimStart();
if (!after.startsWith(");")) {
  console.error("Expected ); after StyleSheet block");
  process.exit(1);
}
const closeLen = ");".length;
const afterBlock = t.slice(i + closeLen);
let body = t.slice(braceOpen + 1, i - 1);
body = body.replace(/colors\./g, "palette.");

const needsPlatform = /\bPlatform\./.test(body);
const needsHairline = /StyleSheet\.hairlineWidth/.test(body);
const rnImports = ["StyleSheet"];
if (needsPlatform) rnImports.push("Platform");
const paletteImport = outPath.includes("/screens/")
  ? `import type { ThemePalette } from "../theme/palettes";`
  : `import type { ThemePalette } from "../theme/palettes";`;

const out = `import { ${rnImports.join(", ")} } from "react-native";
${paletteImport}

export function ${exportFnName}(palette: ThemePalette) {
  return StyleSheet.create({${body}});
}
`;
fs.writeFileSync(outPath, out);
console.log("Wrote", outPath);

if (strip) {
  const endIdx = i + closeLen;
  const before = t.slice(0, start);
  const tail = t.slice(endIdx);
  const next = (before + tail).replace(/\n\n\n+/g, "\n\n");
  fs.writeFileSync(srcPath, next);
  console.log("Stripped styles from", srcPath);
}
