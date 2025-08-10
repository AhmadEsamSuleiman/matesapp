function choosePriorCount(globalImpr) {
  const MIN_PRIOR = 20;
  const MAX_PRIOR = 500;

  if (!globalImpr || globalImpr <= 0) {
    return MIN_PRIOR;
  }

  const p = Math.floor(20 * Math.log10(globalImpr + 1));

  return Math.max(MIN_PRIOR, Math.min(MAX_PRIOR, p));
}

export default choosePriorCount;
