// Distância entre dois pontos na superfície da Terra (fórmula de Haversine).
// Usado no navegador para decidir se você está dentro do raio do escritório.
// Decisão de privacidade: a conta é feita NO SEU DISPOSITIVO; o servidor só
// recebe o resultado ("escritório" / "casa") e a distância arredondada —
// nunca as suas coordenadas.

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg) => (deg * Math.PI) / 180;

export function distanceMeters(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Considera "no escritório" se a distância for menor que o raio + a margem de
 * erro do GPS (accuracy). Ex.: raio 200 m, GPS com precisão de 80 m, distância
 * medida 250 m → 250 <= 280 → provavelmente no escritório (mas pedimos confirmação).
 */
export function isAtOffice(position, office, radiusM) {
  const d = distanceMeters(position, office);
  const tolerance = Math.min(position.accuracy || 0, 500);
  return { distance: Math.round(d), atOffice: d <= radiusM + tolerance };
}
