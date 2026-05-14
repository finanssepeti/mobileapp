import type { AppLang } from "./i18n";
import type { KrediExportLabels } from "./krediExport";
import { t } from "./i18n";

/** Depoda ve state'te kullanılan sabit anahtar (dilden bağımsız). */
export type LoanProductKey = "ihtiyac" | "konut" | "ticari" | "tasit" | "kobi" | "proje";

export const LOAN_PRODUCT_KEYS: LoanProductKey[] = ["ihtiyac", "konut", "ticari", "tasit", "kobi", "proje"];

export const KREDI_CHIP_ROW1: readonly LoanProductKey[] = ["ihtiyac", "konut", "ticari"];
export const KREDI_CHIP_ROW2: readonly LoanProductKey[] = ["tasit", "kobi", "proje"];

const LEGACY_TR_TO_KEY: Record<string, LoanProductKey> = {
  "İhtiyaç Kredisi": "ihtiyac",
  "Konut Kredisi": "konut",
  "Ticari Kredisi": "ticari",
  "Taşıt Kredisi": "tasit",
  "Kobi Kredisi": "kobi",
  "KOBİ Kredisi": "kobi",
  "Proje Kredisi": "proje",
};

export function parseStoredLoanType(raw: string): LoanProductKey {
  const s = (raw || "").trim();
  if ((LOAN_PRODUCT_KEYS as string[]).includes(s)) return s as LoanProductKey;
  return LEGACY_TR_TO_KEY[s] ?? "ihtiyac";
}

export function loanProductLabel(lang: AppLang, key: LoanProductKey): string {
  return t(lang, `loan_product_${key}`);
}

export function loanChipLabel(lang: AppLang, key: LoanProductKey): string {
  return t(lang, `loan_chip_${key}`);
}

export function buildKrediExportLabels(lang: AppLang): KrediExportLabels {
  return {
    csvDocTitle: t(lang, "loan_export_csv_title"),
    csvLoanType: t(lang, "loan_type_label"),
    csvAmount: t(lang, "loan_amount_tl"),
    csvTerm: t(lang, "loan_term_months"),
    csvRate: t(lang, "loan_export_csv_rate_label"),
    csvMonthly: t(lang, "loan_export_csv_monthly_tl"),
    csvTotalPayment: t(lang, "loan_export_csv_total_pay_tl"),
    csvTotalInterest: t(lang, "loan_export_csv_total_int_tl"),
    csvColMonth: t(lang, "loan_plan_col_month"),
    csvColInstallment: t(lang, "loan_plan_col_installment"),
    csvColInterest: t(lang, "loan_plan_col_interest"),
    csvColPrincipal: t(lang, "loan_plan_col_principal"),
    csvColBalance: t(lang, "loan_plan_col_balance"),
    htmlTitle: t(lang, "loan_export_html_title"),
    htmlType: t(lang, "loan_export_html_turk"),
    htmlAmount: t(lang, "loan_export_html_amount"),
    htmlTrySuffix: t(lang, "loan_export_html_tl"),
    htmlTerm: t(lang, "loan_export_html_term"),
    htmlTermSuffix: t(lang, "loan_export_html_term_suffix"),
    htmlRate: t(lang, "loan_export_html_rate"),
    htmlMonthly: t(lang, "loan_export_html_monthly"),
    htmlTotalPay: t(lang, "loan_export_html_total_pay"),
    htmlTotalInt: t(lang, "loan_export_html_total_int"),
    htmlDisclaimer: t(lang, "loan_export_footer"),
  };
}
