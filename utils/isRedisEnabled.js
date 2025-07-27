export default function isEnabled() {
  return process.env.USE_REDIS_CACHE === "true";
}
