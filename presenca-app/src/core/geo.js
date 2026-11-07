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

/**
 * Escritório mais próximo da posição — permite reconhecer EM QUE escritório
 * você está (ex.: chegou ao escritório de Madrid sem ter registrado a viagem).
 */
export function nearestOffice(position, offices) {
  let best = null;
  for (const o of offices) {
    if (!o.location) continue;
    const r = isAtOffice(position, o.location, o.radiusM || 200);
    if (!best || r.distance < best.distance) best = { office: o, ...r };
  }
  return best;
}

/**
 * Decide o que fazer com uma leitura de localização:
 *   'office'   → confiável e dentro do raio do escritório PREVISTO para hoje:
 *                a app registra sozinha (com opção de desfazer);
 *   'probable' → parece estar num escritório, mas com dúvida (GPS impreciso
 *                ou outro escritório que não o previsto): a app pergunta;
 *   'away'     → longe de todos os escritórios: a app pergunta (pode estar
 *                em casa, num cliente, em viagem…).
 *
 * "Confiável" = dentro do raio E precisão do GPS até 250 m. Ex.: raio 200 m,
 * leitura a 35 m com precisão de 20 m → registra; leitura a 600 m com precisão
 * de 900 m → pergunta (pode estar no escritório ou a quarteirões dali).
 */
export const MAX_TRUSTED_ACCURACY_M = 250;

export function assessPosition(position, offices, expectedOfficeId) {
  const best = nearestOffice(position, offices);
  if (!best) return null;
  const accuracy = Math.round(position.accuracy || 0);
  const radius = best.office.radiusM || 200;
  const confident = best.distance <= radius && accuracy <= MAX_TRUSTED_ACCURACY_M;
  let verdict;
  if (confident && best.office.id === expectedOfficeId) verdict = 'office';
  else if (best.atOffice) verdict = 'probable';
  else verdict = 'away';
  return { verdict, office: best.office, distance: best.distance, accuracy };
}
