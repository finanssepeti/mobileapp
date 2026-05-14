/**
 * Bir üst klasördeki teknik-sinyal.js → src/lib/teknikSinyalEngine.js
 * Metro özel modül adına gerek kalmaz.
 *
 * Çalıştır (mobileapp klasöründe): node scripts/install-teknik-engine.cjs
 */
const fs = require("fs");
const path = require("path");

const scriptDir = __dirname;
const mobileRoot = path.join(scriptDir, "..");
const src = path.join(mobileRoot, "..", "teknik-sinyal.js");
const dst = path.join(mobileRoot, "src", "lib", "teknikSinyalEngine.js");

if (!fs.existsSync(src)) {
  console.warn("[install-teknik-engine] Kaynak yok (atlandı):", src);
  console.warn("Üst klasörde teknik-sinyal.js yoksa src/lib/teknikSinyalEngine.js elle kopyalayın.");
  process.exit(0);
}
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.copyFileSync(src, dst);
console.log("Tamam:", dst);
