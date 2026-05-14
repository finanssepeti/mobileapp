/**
 * Üretimde Yahoo + TEFAS trafiğini tek sunucuda toplamak için isteğe bağlı ağ geçidi tabanı.
 * EXPO_PUBLIC_MARKET_GATEWAY_URL boşsa uygulama doğrudan Yahoo / TEFAS’a gider (mevcut davranış).
 */
export function getMarketGatewayBase(): string | null {
  const u = process.env.EXPO_PUBLIC_MARKET_GATEWAY_URL?.trim();
  if (!u) return null;
  return u.replace(/\/+$/, "");
}
