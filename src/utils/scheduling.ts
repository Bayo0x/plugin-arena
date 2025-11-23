export function minutesToMs(minutes: number): number {
  return Math.max(0, minutes) * 60 * 1_000;
}

export function jitteredIntervalMinutes(
  min?: number,
  max?: number,
  fallback?: number,
): number {
  if (typeof min === "number" && typeof max === "number" && max >= min) {
    if (min === max) {
      return min;
    }
    const delta = max - min;
    return min + Math.random() * delta;
  }

  if (typeof fallback === "number") {
    return fallback;
  }

  return 1; // Default to 1 minute if everything else fails
}

