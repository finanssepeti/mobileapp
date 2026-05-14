/**
 * Expo Go QR/LAN: Windows'ta sanal adaptörler yüzünden yanlış IP seçilebiliyor.
 * REACT_NATIVE_PACKAGER_HOSTNAME veya EXPO_LAN_HOST ile IP'yi elle sabitleyin (en güvenilir).
 * Metro portu (--port + EXPO_METRO_PORT) ile QR URL'deki port aynı olmalı; 8081 meşgulse örn.:
 *   PowerShell: $env:EXPO_METRO_PORT="8082"; $env:RCT_METRO_PORT="8082"; npm run start:expo-go
 * Metro önbelleğini silerek başlatmak: $env:EXPO_CLEAR_METRO="1"; npm run start:expo-go
 * Aynı Wi‑Fi'de değilseniz / tarayıcı açılmıyorsa: npm run start:expo-go:tunnel
 * Metro açıkken QR'ı yenilemek: aynı EXPO_METRO_PORT ile  npm run expo-go:qr
 * Terminalde QR görünmüyorsa (Cursor/Windows): `npm run qr` proje köküne expo-go-qr.html yazar ve tarayıcıda açar.
 * Tarayıcı açılmasın: $env:EXPO_QR_SKIP_BROWSER="1"; npm run qr
 * Terminal QR varsayılan küçük; daha büyük (kolay tarama): $env:EXPO_QR_LARGE="1"
 * Eski: $env:EXPO_QR_COMPACT="0" da büyük QR üretir.
 * `npm start` doğrudan `expo start` kullanırsa LAN IP bazen yanlış kalır → Expo Go "Something went wrong"; bu betik `npm start` ile de çalışır.
 */
const path = require("path");
const fs = require("fs");
const { spawn, execFile } = require("child_process");
const net = require("net");
const os = require("os");

const projectRoot = path.resolve(__dirname, "..");

function getLanNetworkSyncAddress() {
  try {
    const { lanNetworkSync } = require("lan-network");
    const a = lanNetworkSync()?.address;
    return typeof a === "string" && a.length > 0 ? a : null;
  } catch {
    return null;
  }
}

function listLanIPv4Candidates() {
  const nets = os.networkInterfaces();
  const candidates = [];
  const skipName = (lower) =>
    lower.includes("virtual") ||
    lower.includes("vethernet") ||
    lower.includes("hyper-v") ||
    lower.includes("wsl") ||
    lower.includes("vmware") ||
    lower.includes("vbox") ||
    lower.includes("npcap") ||
    lower.includes("tap-windows") ||
    lower.includes("vpn") ||
    lower.includes("hamachi") ||
    lower.includes("zerotier") ||
    lower.includes("tailscale") ||
    lower.includes("nordlynx") ||
    lower.includes("outline") ||
    lower.includes("cisco anyconnect") ||
    lower.includes("openvpn") ||
    lower.includes("wireguard") ||
    lower.includes("ppp") ||
    lower.includes("radmin") ||
    lower.includes("ngrok") ||
    lower.includes("bluetooth");

  for (const name of Object.keys(nets)) {
    const lower = name.toLowerCase();
    if (skipName(lower)) continue;
    for (const net of nets[name] || []) {
      const fam = net.family;
      if (fam !== "IPv4" && fam !== 4) continue;
      if (net.internal) continue;
      candidates.push({ name, address: net.address });
    }
  }
  const score = (a) => {
    let s = 50;
    const lower = a.name.toLowerCase();
    if (a.address.startsWith("192.168.")) s = 100;
    else if (a.address.startsWith("10.")) s = 90;
    else {
      const m = a.address.match(/^172\.(\d+)\./);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n >= 16 && n <= 31) s = 80;
      }
    }
    if (
      lower.includes("wi-fi") ||
      lower.includes("wifi") ||
      lower.includes("wlan") ||
      lower.includes("wireless") ||
      lower.includes("kablosuz")
    ) {
      s += 8;
    }
    if (lower.includes("ethernet") || lower.includes("gigabit")) {
      s += 2;
    }
    return s;
  };
  candidates.sort((a, b) => score(b) - score(a));
  return candidates;
}

/** Expo CLI'nin `lan-network` ile seçtiği IP, filtrelenmiş arayüzlerden biriyse onu kullan (QR ile Metro uyumu). */
function pickLanFromSorted(sorted) {
  const ln = getLanNetworkSyncAddress();
  if (ln && sorted.some((c) => c.address === ln)) {
    return ln;
  }
  return sorted[0]?.address || null;
}

function pickLanIPv4() {
  return pickLanFromSorted(listLanIPv4Candidates()) || null;
}

function warnIfAmbiguousLan(sorted, chosen) {
  if (!chosen || sorted.length < 2) return;
  if ((process.env.EXPO_LAN_HOST || "").trim()) return;
  const others = sorted.filter((c) => c.address !== chosen).slice(0, 5);
  if (others.length === 0) return;
  console.warn("[FinansSepeti] Birden fazla yerel IP var; Expo Go 'Something went wrong' ise şunu deneyin:");
  console.warn('  $env:EXPO_LAN_HOST="' + others[0].address + '"  (veya listedeki başka IP)');
  others.forEach((c) => console.warn("  • " + c.name + ": " + c.address));
}

const userArgs = process.argv.slice(2);
const wantTunnel = userArgs.includes("--tunnel");
const wantQrOnly = userArgs.includes("--qr-only");
const filteredUser = userArgs.filter((a) => a !== "--tunnel" && a !== "--qr-only");

/** Metro ile aynı port (aksi halde betiğin bastığı QR yanlış olur → Expo Go “Something went wrong”). */
function resolveMetroPort(argv) {
  const envPort = process.env.EXPO_METRO_PORT || process.env.RCT_METRO_PORT || process.env.PORT;
  if (envPort) return String(parseInt(envPort, 10) || 8081);
  const i = argv.findIndex((a) => a === "--port" || a.startsWith("--port="));
  if (i >= 0) {
    if (argv[i].startsWith("--port=")) return String(parseInt(argv[i].slice("--port=".length), 10) || 8081);
    const next = argv[i + 1];
    if (next && !next.startsWith("-")) return String(parseInt(next, 10) || 8081);
  }
  return "8081";
}

const metroPort = resolveMetroPort(filteredUser);
process.env.EXPO_METRO_PORT = metroPort;
process.env.RCT_METRO_PORT = metroPort;

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

/** Terminal QR çizilemese bile tarayıcıda taranabilir PNG QR (ücretsiz API; yalnızca geliştirme). */
function writeExpoGoQrHtml(projectRoot, expUrl) {
  const imgSrc =
    "https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=" + encodeURIComponent(expUrl);
  const html =
    "<!DOCTYPE html><html lang=\"tr\"><head><meta charset=\"utf-8\"/><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"/>" +
    "<title>FinansSepeti — Expo Go QR</title>" +
    "<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc;padding:24px;text-align:center}" +
    "code{word-break:break-all;font-size:14px;background:#1e293b;padding:10px 14px;border-radius:8px;display:inline-block;margin:16px 0;max-width:100%}" +
    "img{border-radius:12px;background:#fff;padding:10px}</style></head><body>" +
    "<h1>Expo Go</h1>" +
    "<p>Telefonla <strong>bu sayfadaki QR</strong> kodunu tarayın veya Expo Go içinde <strong>Enter URL</strong> ile aşağıdaki adresi yapıştırın.</p>" +
    "<p><code>" +
    escapeHtml(expUrl) +
    "</code></p>" +
    "<p><img width=\"360\" height=\"360\" alt=\"Expo Go QR\" src=\"" + imgSrc + "\"/></p>" +
    "</body></html>";
  const out = path.join(projectRoot, "expo-go-qr.html");
  fs.writeFileSync(out, html, "utf8");
  return out;
}

function openQrHtmlInBrowser(htmlPath) {
  const skip = String(process.env.EXPO_QR_SKIP_BROWSER || "").toLowerCase();
  if (skip === "1" || skip === "true") return;
  try {
    if (process.platform === "win32") {
      execFile("cmd", ["/c", "start", "", htmlPath], { windowsHide: true }, () => {});
    } else if (process.platform === "darwin") {
      execFile("open", [htmlPath], () => {});
    } else {
      execFile("xdg-open", [htmlPath], () => {});
    }
  } catch {
    /* noop */
  }
}

/** @param {{ openBrowser?: boolean }} [opts] */
function printExpoGoQrInTerminal(host, port, opts) {
  const expUrl = `exp://${host}:${port}`;
  const ce = String(process.env.EXPO_QR_COMPACT || "").toLowerCase();
  const forceSmall = ce === "1";
  const forceLarge = ce === "0" || String(process.env.EXPO_QR_LARGE || "").toLowerCase() === "1";
  const useSmallBlocks = forceSmall ? true : forceLarge ? false : true;
  try {
    const qrcode = require("qrcode-terminal");
    console.log("\n[FinansSepeti] Expo Go — aynı Wi‑Fi'de bu QR kodunu taratın:\n");
    qrcode.generate(expUrl, { small: useSmallBlocks });
    console.log("Manuel URL: " + expUrl + "\n");
  } catch {
    console.warn(
      "[FinansSepeti] qrcode-terminal bulunamadı. Projede `npm install` çalıştırın. URL: " +
        expUrl,
    );
  }
  try {
    const htmlPath = writeExpoGoQrHtml(projectRoot, expUrl);
    console.log("[FinansSepeti] QR sayfası (tarayıcı): " + htmlPath);
    if (opts && opts.openBrowser) {
      openQrHtmlInBrowser(htmlPath);
    }
  } catch (eW) {
    console.warn("[FinansSepeti] expo-go-qr.html yazılamadı:", eW && eW.message ? eW.message : eW);
  }
}

function printQrTroubleshoot(port) {
  console.log(
    [
      "[FinansSepeti] QR / Expo Go 'Something went wrong' ise:",
      "  • `npm start` bu projede `expo start` yerine bu betiği kullanır (LAN IP Metro ile aynı).",
      "  • PC ile telefon aynı Wi‑Fi (misafir/kurumsal ağda cihazlar birbirini görmeyebilir).",
      "  • Play Store / App Store'dan Expo Go'yu güncelleyin (SDK 54).",
      "  • Windows Güvenlik Duvarı'nda Node.js'e özel ağda izin verin.",
      "  • IP yanlışsa: $env:EXPO_LAN_HOST=\"192.168.x.x\"; npm run start:expo-go",
      "  • Ağ zor: npm run start:expo-go:tunnel (internet gerekir, QR Metro terminalinde çıkar).",
      "  • Metro kapalıyken `npm run qr` taranırsa hata verir; önce sunucuyu başlatın.",
      "  • Terminalde QR görünmüyorsa: `npm run qr` → proje kökünde `expo-go-qr.html` açılır (veya dosyaya çift tıklayın).",
      "",
    ].join("\n"),
  );
}

function metroListening(port, cb) {
  const p = Number(port, 10) || 8081;
  let settled = false;
  const once = (v) => {
    if (settled) return;
    settled = true;
    cb(v);
  };
  const socket = net.connect({ host: "127.0.0.1", port: p }, () => {
    socket.end();
    once(true);
  });
  socket.setTimeout(600, () => {
    socket.destroy();
    once(false);
  });
  socket.on("error", () => once(false));
}

function printLanExpoGoQr(opts) {
  const wantQrOnly = opts?.qrOnly;
  const fromExpoLan = (process.env.EXPO_LAN_HOST || "").trim();
  let ip = fromExpoLan || process.env.REACT_NATIVE_PACKAGER_HOSTNAME || "";
  if (fromExpoLan) {
    process.env.REACT_NATIVE_PACKAGER_HOSTNAME = fromExpoLan;
    console.log("[FinansSepeti] Expo Go LAN: EXPO_LAN_HOST=" + fromExpoLan);
  } else if (process.env.REACT_NATIVE_PACKAGER_HOSTNAME) {
    ip = process.env.REACT_NATIVE_PACKAGER_HOSTNAME;
    console.log("[FinansSepeti] Expo Go LAN: ortamda REACT_NATIVE_PACKAGER_HOSTNAME=" + ip);
  } else {
    const sorted = listLanIPv4Candidates();
    ip = pickLanFromSorted(sorted) || "";
    if (ip) {
      process.env.REACT_NATIVE_PACKAGER_HOSTNAME = ip;
      console.log("[FinansSepeti] Expo Go LAN: otomatik seçilen IP → REACT_NATIVE_PACKAGER_HOSTNAME=" + ip);
      warnIfAmbiguousLan(sorted, ip);
    }
  }
  if (!ip) {
    console.warn(
      "[FinansSepeti] LAN IP bulunamadı. Telefon farklı ağdaysa: npm run start:expo-go:tunnel",
    );
    printQrTroubleshoot(metroPort);
    if (opts?.qrOnly) process.exit(0);
    return;
  }
  if (wantQrOnly) {
    metroListening(metroPort, (up) => {
      if (!up) {
        console.warn(
          "[FinansSepeti] Uyarı: Bu bilgisayarda " +
            metroPort +
            " portunda Metro dinlemiyor gibi. QR'ı taratsanız bağlantı kurulamaz. Önce `npm run start:expo-go` (aynı EXPO_METRO_PORT) açın.\n",
        );
      }
      printExpoGoQrInTerminal(ip, metroPort, { openBrowser: true });
      printQrTroubleshoot(metroPort);
      process.exit(0);
    });
    return;
  }
  printExpoGoQrInTerminal(ip, metroPort, { openBrowser: false });
}

if (wantQrOnly) {
  if (wantTunnel) {
    console.log(
      "[FinansSepeti] Tunnel modunda QR bu kısayolda yok; Metro/Expo terminalindeki QR veya `npm run start:expo-go:tunnel` çıktısına bakın.\n",
    );
    process.exit(0);
  }
  printLanExpoGoQr({ qrOnly: true });
} else if (!wantTunnel) {
  printLanExpoGoQr({ qrOnly: false });
} else {
  console.log(
    "[FinansSepeti] Tunnel modu: exp adresi ve QR Metro / Expo çıktısında listelenir (ngrok).\n",
  );
}

/** node_modules/.bin/expo.cmd + shell:true, Windows'ta boşluklu kullanıcı yolunda kırılıyor (C:\Users\KARACA ...). */
const expoCli = path.join(projectRoot, "node_modules", "expo", "bin", "cli");
const userWithoutPort = (() => {
  const a = [...filteredUser];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--port") {
      a.splice(i, 2);
      i--;
      continue;
    }
    if (a[i].startsWith("--port=")) {
      a.splice(i, 1);
      i--;
    }
  }
  return a;
})();
/** Tam önbellek temizliği her seferinde yavaşlatır; gerekirse: EXPO_CLEAR_METRO=1 veya npm run start:clear:lan */
const wantClear = String(process.env.EXPO_CLEAR_METRO || "").toLowerCase() === "1" || userArgs.includes("--clear");
const expoArgs = [
  "start",
  ...(wantClear ? ["-c"] : []),
  ...(wantTunnel ? ["--tunnel"] : ["--lan"]),
  "--port",
  metroPort,
  ...userWithoutPort.filter((a) => a !== "--clear"),
];

const child = spawn(process.execPath, [expoCli, ...expoArgs], {
  stdio: "inherit",
  env: process.env,
  cwd: projectRoot,
  shell: false,
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
