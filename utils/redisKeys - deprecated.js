export function zkey(sessionId, ...parts) {
  return ["sess", sessionId, ...parts].join(":");
}
export const KEY_TTL = 60 * 60;
