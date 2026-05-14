/**
 * Firebase Console ile aynı projeye Firestore + Storage kurallarını yükler
 * (yorum/medya için Storage şart; yalnız Firestore yetmez).
 * Proje kimliği: EXPO_PUBLIC_FIREBASE_PROJECT_ID veya kökteki .env
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");

function readProjectIdFromEnvFile() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return "";
  const txt = fs.readFileSync(envPath, "utf8");
  const m = txt.match(/^\s*EXPO_PUBLIC_FIREBASE_PROJECT_ID\s*=\s*(.+)$/m);
  if (!m) return "";
  return m[1].trim().replace(/^["']|["']$/g, "").replace(/\s+#.*$/, "");
}

const projectId =
  (process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "").trim() || readProjectIdFromEnvFile();

if (!projectId) {
  console.error(
    "[deploy-firestore-rules] EXPO_PUBLIC_FIREBASE_PROJECT_ID tanımlı değil (.env veya ortam değişkeni).",
  );
  process.exit(1);
}

console.log("[deploy-firestore-rules] project:", projectId);

const r = spawnSync(
  "npx",
  ["--yes", "firebase-tools", "deploy", "--only", "firestore:rules,storage", "--project", projectId],
  { stdio: "inherit", cwd: root, shell: true },
);

process.exit(typeof r.status === "number" ? r.status : 1);
