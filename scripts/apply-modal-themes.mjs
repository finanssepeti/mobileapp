/**
 * Migrates components that import `colors` + `const styles = StyleSheet.create(...)`
 * to ThemePalette factory + hook usage.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "src");

const FILES = [
  "components\\TradingViewChartModal.tsx",
  "components\\MesajlarimModal.tsx",
  "components\\ForumModal.tsx",
  "components\\YorumlarimModal.tsx",
  "components\\YatirimModal.tsx",
  "components\\KredilerModal.tsx",
  "components\\PiyasalarModal.tsx",
  "components\\HarcamalarModal.tsx",
  "components\\PortfoyumModal.tsx",
  "components\\SocialProfileModal.tsx",
  "screens\\LoginScreen.tsx",
  "screens\\PrivacyScreen.tsx",
  "screens\\AnalizlerScreen.tsx",
];

function braceMatchEnd(s, startIdx) {
  let depth = 0;
  for (let i = startIdx; i < s.length; i++) {
    const c = s[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function transform(content, relPath) {
  if (!content.includes('from "../theme/colors"') && !content.includes("from '../../theme/colors'")) return null;
  const marker = "const styles = StyleSheet.create(";
  const idx = content.indexOf(marker);
  if (idx < 0) return null;

  const openParen = idx + marker.length - 1; // '('
  const openBrace = idx + marker.length;
  const endBrace = braceMatchEnd(content, openBrace);
  if (endBrace < 0) return null;
  let end = endBrace + 1;
  while (content[end] === ")") end++;
  while (content[end] === ";") end++;
  while (content[end] === "\r" || content[end] === "\n") end++;

  const baseName = path.basename(relPath, ".tsx").replace(/[^a-zA-Z0-9]/g, "_");
  const factoryName = `create${baseName}_styles`;

  const styleBlockInner = content.slice(openBrace + 1, endBrace);

  let out = content;
  out = out.replace(
    /import \{ colors \} from "\.\.\/theme\/colors";/,
    `import type { ThemePalette } from "../theme/palettes";\nimport { useThemeColors } from "../theme/ThemeProvider";`,
  );
  out = out.replace(
    /import \{ colors \} from "\.\.\/\.\.\/theme\/colors";/,
    `import type { ThemePalette } from "../../theme/palettes";\nimport { useThemeColors } from "../../theme/ThemeProvider";`,
  );

  out = `${out.slice(0, idx)}\nfunction ${factoryName}(colors: ThemePalette) {\n  return StyleSheet.create(${styleBlockInner});\n}\n${out.slice(end)}`;

  const exportFn = [...out.matchAll(/export\s+function\s+(\w+)\s*\(/g)].map((m) => m[1]);
  const mainCmp = exportFn[0];

  let hookInject = `  const palette = useThemeColors();\n  const styles = useMemo(() => ${factoryName}(palette), [palette]);\n`;
  if (mainCmp) {
    const fnRe = new RegExp(`export\\s+function\\s+${mainCmp}\\s*\\([^)]*\\)\\s*\\{`);
    const mi = out.search(fnRe);
    if (mi >= 0) {
      const open = out.indexOf("{", mi);
      let needUseMemo =
        !out.includes("useMemo") && out.includes(`${factoryName}(palette)`);
      const reactImportNeed = [];
      const firstLineRest = open + 1;
      const insertPayload =
        (!out.slice(0, 200).includes("useMemo")
          ? "" /* add useMemo to react import separately */
          : "") + hookInject;

      /** add useMemo to React import */
      const ri = out.indexOf(`import React`);
      if (ri >= 0 && hookInject.includes("useMemo") && !/useMemo/.test(out.slice(ri, ri + 120))) {
        out = out.replace(/import React(?:, \{[^}]+\})? from "react";/, (m) => {
          if (m.includes("{")) {
            return m.replace(/\}\s+from/, ", useMemo } from");
          }
          return `import React, { useMemo } from "react";`;
        });
      }

      /** ensure useMemo in named import line */
      if (!/from "react";/.test(out.slice(0, 400))) {
        /* noop */
      }

      /** Standard: `import React, { useState,...} from react` — append useMemo */
      out = out.replace(/import React, \{([^}]+)\} from "react";/, (_, inner) => {
        if (inner.includes("useMemo")) return `import React, {${inner}} from "react";`;
        const parts = inner.split(",").map((s) => s.trim()).filter(Boolean);
        if (!parts.includes("useMemo")) parts.unshift("useMemo");
        return `import React, { ${parts.join(", ")} } from "react";`;
      });

      /** insert hook after opening brace */
      let depth = 0;
      let j = mi;
      for (; j < out.length; j++) {
        if (out[j] === "{") depth++;
        else if (out[j] === "}") depth--;
      }
      const fnOpenBrace = out.indexOf("{", out.search(fnRe));
      const hookPoint = fnOpenBrace + 1;

      /** avoid double inject */
      if (!out.includes(`${factoryName}(palette)`)) {
        out = out.slice(0, hookPoint) + "\n" + hookInject + out.slice(hookPoint);
      } else if (!out.includes("const palette = useThemeColors()")) {
        out = out.slice(0, hookPoint) + "\n" + hookInject + out.slice(hookPoint);
      }

      /** replace remaining colors. in JSX (not inside factory - factory uses colors parameter) */

      /** Factory uses `colors`; JSX in component body should use `palette` */

      /** Split component function body naive: inject after `{` doesn't work if hook already duplicated */

      console.warn(relPath + ": manual JSX colors.* -> palette.* still needed.");
    }
  }

  /** Post: replace JSX colors. with palette. only OUTSIDE factory - risky if factory name inner */

  /** Inline replace simplistic: colors -> palette globally breaks factory parameter */

  console.log("Transformed structure for", relPath, "- VERIFY manually");

  return out;
}

for (const f of FILES) {
  const fp = path.join(root, ...f.split("\\"));
  if (!fs.existsSync(fp)) {
    console.warn("Missing", fp);
    continue;
  }
  const txt = fs.readFileSync(fp, "utf8");
  const nb = transform(txt, f);
  if (nb && nb !== txt) {
    fs.writeFileSync(fp, nb);
    console.log("Wrote", fp);
  } else console.log("Skip", fp);
}
