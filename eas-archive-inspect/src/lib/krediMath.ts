/**
 * Eşit taksitli kredi (annüite) — bankacılıkta yaygın PMT formülü.
 * r: dönem başına faiz (ör. aylık 0.03 → %3 değil; 0.03 = %3 aylık için 3/100)
 */
export type InterestMode = "yearly" | "monthly";

export function monthlyRateFromPercent(ratePercent: number, mode: InterestMode): number {
  if (!Number.isFinite(ratePercent) || ratePercent < 0) return 0;
  if (mode === "yearly") return ratePercent / 100 / 12;
  return ratePercent / 100;
}

export function annuityPayment(principal: number, months: number, monthlyRate: number): number {
  if (!Number.isFinite(principal) || principal <= 0) return 0;
  if (!Number.isFinite(months) || months <= 0) return 0;
  if (!Number.isFinite(monthlyRate) || monthlyRate <= 0) return principal / months;
  const r = monthlyRate;
  const n = Math.floor(months);
  const pow = Math.pow(1 + r, n);
  return (principal * r * pow) / (pow - 1);
}

export function buildAmortizationSchedule(
  principal: number,
  months: number,
  monthlyRate: number,
  monthlyPayment: number
): Array<{ month: number; payment: number; interest: number; principal: number; balance: number }> {
  const rows: Array<{ month: number; payment: number; interest: number; principal: number; balance: number }> =
    [];
  let bal = principal;
  const n = Math.min(Math.floor(months), 360);
  const pay = monthlyPayment;
  for (let m = 1; m <= n && bal > 0.01; m++) {
    const interest = bal * monthlyRate;
    let princPart = pay - interest;
    if (princPart > bal) princPart = bal;
    const actualPay = interest + princPart;
    bal = Math.max(0, bal - princPart);
    rows.push({ month: m, payment: actualPay, interest, principal: princPart, balance: bal });
  }
  return rows;
}
