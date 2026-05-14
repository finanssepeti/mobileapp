/**
 * Üst klasördeki teknik-sinyal.js → src/lib/teknikSinyalEngine.js
 * Çalıştır: node scripts/copy-teknik-engine.js
 */
const fs = require("fs");
const path = require("path");

const mobileRoot = path.join(__dirname, "..");
const repoRoot = path.join(mobileRoot, "..");
const src = path.join(repoRoot, "teknik-sinyal.js");
const dst = path.join(mobileRoot, "src", "lib", "teknikSinyalEngine.js");

if (!fs.existsSync(src)) {
  console.error("Kaynak bulunamadi:", src);
  process.exit(1);
}
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.copyFileSync(src, dst);
console.log("Kopyalandi:", dst);
