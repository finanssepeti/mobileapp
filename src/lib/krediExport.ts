import type { buildAmortizationSchedule } from "./krediMath";

export type AmortRow = ReturnType<typeof buildAmortizationSchedule>[number];

export type KrediExportMeta = {
  /** Görüntüleme / dışa aktarma için çevrilmiş kredi türü adı */
  kturu: string;
  tutar: number;
  vadeAy: number;
  faizMetni: string;
  aylikTaksit: number;
  toplamOdeme: number;
  toplamFaiz: number;
};

export type KrediExportLabels = {
  csvDocTitle: string;
  csvLoanType: string;
  csvAmount: string;
  csvTerm: string;
  csvRate: string;
  csvMonthly: string;
  csvTotalPayment: string;
  csvTotalInterest: string;
  csvColMonth: string;
  csvColInstallment: string;
  csvColInterest: string;
  csvColPrincipal: string;
  csvColBalance: string;
  htmlTitle: string;
  htmlType: string;
  htmlAmount: string;
  htmlTrySuffix: string;
  htmlTerm: string;
  htmlTermSuffix: string;
  htmlRate: string;
  htmlMonthly: string;
  htmlTotalPay: string;
  htmlTotalInt: string;
  htmlDisclaimer: string;
};

function trSayi(n: number) {
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Excel’de Türkçe locale için noktalı virgül ayırıcı + UTF-8 BOM */
export function scheduleToCsv(rows: AmortRow[], meta: KrediExportMeta, L: KrediExportLabels): string {
  const s = ";";
  const lines: string[] = ["\ufeff"];
  lines.push(L.csvDocTitle);
  lines.push(`${L.csvLoanType}${s}${meta.kturu}`);
  lines.push(`${L.csvAmount}${s}${trSayi(meta.tutar)}`);
  lines.push(`${L.csvTerm}${s}${meta.vadeAy}`);
  lines.push(`${L.csvRate}${s}${meta.faizMetni}`);
  lines.push(`${L.csvMonthly}${s}${trSayi(meta.aylikTaksit)}`);
  lines.push(`${L.csvTotalPayment}${s}${trSayi(meta.toplamOdeme)}`);
  lines.push(`${L.csvTotalInterest}${s}${trSayi(meta.toplamFaiz)}`);
  lines.push("");
  lines.push(
    [L.csvColMonth, `${L.csvColInstallment} (TL)`, `${L.csvColInterest} (TL)`, `${L.csvColPrincipal} (TL)`, `${L.csvColBalance} (TL)`].join(
      s
    )
  );
  for (const r of rows) {
    lines.push(
      [r.month, trSayi(r.payment), trSayi(r.interest), trSayi(r.principal), trSayi(r.balance)].join(s)
    );
  }
  return lines.join("\r\n");
}

export function scheduleToPrintHtml(rows: AmortRow[], meta: KrediExportMeta, L: KrediExportLabels): string {
  const head = `<tr><th>${escapeHtml(L.csvColMonth)}</th><th>${escapeHtml(L.csvColInstallment + " (TL)")}</th><th>${escapeHtml(
    L.csvColInterest + " (TL)"
  )}</th><th>${escapeHtml(L.csvColPrincipal + " (TL)")}</th><th>${escapeHtml(L.csvColBalance + " (TL)")}</th></tr>`;
  const body = rows
    .map(
      (r) =>
        `<tr><td>${r.month}</td><td>${trSayi(r.payment)}</td><td>${trSayi(r.interest)}</td><td>${trSayi(r.principal)}</td><td>${trSayi(r.balance)}</td></tr>`
    )
    .join("");
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
body{font-family:system-ui,-apple-system,sans-serif;font-size:11px;color:#111;padding:12px;}
h1{font-size:16px;margin:0 0 8px;}
.meta{margin:0 0 14px;line-height:1.5;color:#333;}
table{border-collapse:collapse;width:100%;font-size:10px;}
th,td{border:1px solid #334155;padding:5px 6px;text-align:right;}
th{background:#1a237e;color:#fff;text-align:center;}
td:first-child,th:first-child{text-align:center;width:40px;}
tr:nth-child(even){background:#f1f5f9;}
</style></head><body>
<h1>${escapeHtml(L.htmlTitle)}</h1>
<div class="meta">
<strong>${escapeHtml(L.htmlType)}</strong> ${escapeHtml(meta.kturu)}<br/>
<strong>${escapeHtml(L.htmlAmount)}</strong> ${trSayi(meta.tutar)}${escapeHtml(L.htmlTrySuffix)} &nbsp;|&nbsp; <strong>${escapeHtml(
    L.htmlTerm
  )}</strong> ${meta.vadeAy}${escapeHtml(L.htmlTermSuffix)}<br/>
<strong>${escapeHtml(L.htmlRate)}</strong> ${escapeHtml(meta.faizMetni)}<br/>
<strong>${escapeHtml(L.htmlMonthly)}</strong> ${trSayi(meta.aylikTaksit)}${escapeHtml(L.htmlTrySuffix)} &nbsp;|&nbsp; <strong>${escapeHtml(
    L.htmlTotalPay
  )}</strong> ${trSayi(meta.toplamOdeme)}${escapeHtml(L.htmlTrySuffix)}<br/>
<strong>${escapeHtml(L.htmlTotalInt)}</strong> ${trSayi(meta.toplamFaiz)}${escapeHtml(L.htmlTrySuffix)}
</div>
<table><thead>${head}</thead><tbody>${body}</tbody></table>
<p style="font-size:9px;color:#64748b;margin-top:10px;">${escapeHtml(L.htmlDisclaimer)}</p>
</body></html>`;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
