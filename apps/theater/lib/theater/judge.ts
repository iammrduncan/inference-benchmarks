// Display policy only; never changes the model's raw accuracy or completeness flag.
// A score equal to the threshold does NOT pass (the UI says strictly greater than).
export function passesThreshold(score: number, threshold: number): boolean {
  return Number.isFinite(score) && score > threshold;
}
