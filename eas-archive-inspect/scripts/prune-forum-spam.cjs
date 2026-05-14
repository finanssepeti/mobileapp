/**
 * İstenmeyen forum konularını siler (anonim Firebase oturumu + delete kuralı).
 * Çalıştır: npm run forum:prune-spam
 */
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (k.startsWith("EXPO_PUBLIC_")) process.env[k] = v;
  }
}

loadEnv();

const { initializeApp } = require("firebase/app");
const { getAuth, signInAnonymously } = require("firebase/auth");
const {
  getFirestore,
  collection,
  getDocs,
  deleteDoc,
  doc,
} = require("firebase/firestore");

function normalizeForumHashtag(raw) {
  let s = String(raw || "").trim().replace(/\s+/g, "");
  if (!s.startsWith("#")) s = `#${s.replace(/^#+/, "")}`;
  const body = s
    .slice(1)
    .replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ._-]/g, "")
    .toLocaleLowerCase("tr-TR");
  return `#${body}`;
}

const cfg = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

if (!cfg.apiKey || !cfg.projectId) {
  console.error("[prune-forum-spam] .env içinde EXPO_PUBLIC_FIREBASE_API_KEY ve PROJECT_ID gerekli.");
  process.exit(1);
}

const app = initializeApp(cfg);
const auth = getAuth(app);
const db = getFirestore(app);

/** Bu hashtag / doc id eşleşenleri sil (rastgele doc id: eski hatalı kayıtlar) */
const REMOVE_NORMALIZED = new Set(["#stuy", "#l0qgrd"]);
const REMOVE_DOC_IDS = new Set([
  "stuy",
  "l0qgrd",
  "l0QgrdA4xfAdt3wQNamg",
  "sTUy2XoPIgc65cxal5Vt",
]);

(async () => {
  const listOnly = process.argv.includes("--list");
  const snap = await getDocs(collection(db, "forumTopics"));
  if (listOnly) {
    console.log("[prune-forum-spam] forumTopics (docId → normalize | ham) — okuma herkese açık:");
    for (const d of snap.docs) {
      const tag = typeof d.data().hashtag === "string" ? d.data().hashtag : "";
      console.log(" ", d.id, "→", normalizeForumHashtag(tag), "| ham:", tag);
    }
    console.log(
      "\nSilmek için: önce Firebase Console → Authentication → Anonymous = Etkin.\nSonra: npm run forum:prune-spam\nVeya (CLI girişli): npx firebase firestore:delete \"forumTopics/BELGE_ID\" --project finans-sepeti -f",
    );
    process.exit(0);
  }

  try {
    await signInAnonymously(auth);
  } catch (e) {
    console.error(
      "[prune-forum-spam] Anonim giriş başarısız (auth/admin-restricted-operation).\n" +
        "1) https://console.firebase.google.com → Authentication → Sign-in method → Anonymous = Etkin\n" +
        "2) Tekrar: npm run forum:prune-spam\n" +
        "Alternatif: npm run forum:prune-spam --list ile BELGE_ID alıp:\n" +
        '  npx firebase firestore:delete "forumTopics/BELGE_ID" --project finans-sepeti -f\n',
    );
    throw e;
  }
  if (!auth.currentUser) {
    console.error("[prune-forum-spam] Oturum yok.");
    process.exit(1);
  }

  let n = 0;
  for (const d of snap.docs) {
    const tag = typeof d.data().hashtag === "string" ? d.data().hashtag : "";
    const norm = normalizeForumHashtag(tag);
    const idLow = d.id.toLowerCase();
    if (
      REMOVE_NORMALIZED.has(norm) ||
      REMOVE_DOC_IDS.has(idLow) ||
      REMOVE_DOC_IDS.has(norm.replace(/^#/, ""))
    ) {
      console.log("[prune-forum-spam] Siliniyor:", d.id, "→", norm || tag);
      await deleteDoc(doc(db, "forumTopics", d.id));
      n += 1;
    }
  }
  console.log("[prune-forum-spam] Tamam, silinen:", n);
})().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
