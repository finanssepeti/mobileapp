import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modalPath = path.join(__dirname, "..", "src", "components", "ProfilimModal.tsx");
const outPath = path.join(__dirname, "..", "src", "components", "profilimModalStyles.ts");

const s = fs.readFileSync(modalPath, "utf8");
const marker = "const styles = StyleSheet.create({";
const i = s.indexOf(marker);
if (i < 0) throw new Error("marker not found");
const start = i + marker.length - 1;
if (s[start] !== "{") throw new Error("expected {");
let depth = 0;
let endObj = -1;
for (let k = start; k < s.length; k++) {
  const c = s[k];
  if (c === "{") depth++;
  else if (c === "}") {
    depth--;
    if (depth === 0) {
      endObj = k;
      break;
    }
  }
}
if (endObj < 0) throw new Error("unclosed brace");
const inner = s.slice(start + 1, endObj).trimEnd();
let k = endObj + 1;
while (s[k] === ")") k++;
while (s[k] === ";") k++;
/** remove optional trailing newline after stylesheet */
const preamble = `import { StyleSheet } from "react-native";
import type { ThemePalette } from "../theme/palettes";

/** ProfilimModal + iç içe FeedSection / yardımcı bileşenler */
export function createProfilimModalStyles(colors: ThemePalette) {
  return StyleSheet.create({
`;
const tail = `
    loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center", paddingVertical: 24 },
    loadingText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
    headerGhost: { width: 64 },
  });
}
`;
fs.writeFileSync(outPath, `${preamble}${inner},\n${tail}`);
console.log("Wrote", outPath);
