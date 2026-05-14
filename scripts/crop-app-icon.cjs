/**
 * Expo doctor requires a square app icon. Crops logo/app-icon.png to min(width,height), centered.
 * Run after `npm install` (needs devDependency `sharp`).
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

async function main() {
  const iconPath = path.join(__dirname, "..", "logo", "app-icon.png");
  if (!fs.existsSync(iconPath)) {
    console.error("Missing:", iconPath);
    process.exit(1);
  }
  const meta = await sharp(iconPath).metadata();
  const w = meta.width;
  const h = meta.height;
  if (!w || !h) {
    throw new Error("Could not read image dimensions");
  }
  if (w === h) {
    console.log("app-icon.png already square:", w, "x", h);
    return;
  }
  const size = Math.min(w, h);
  const left = Math.floor((w - size) / 2);
  const top = Math.floor((h - size) / 2);
  const out = await sharp(iconPath)
    .extract({ left, top, width: size, height: size })
    .png()
    .toBuffer();
  await fs.promises.writeFile(iconPath, out);
  console.log("Cropped app-icon.png:", `${w}x${h}`, "->", `${size}x${size}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
