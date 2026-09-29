/** Returns true when streamed answer text should replace the generic thinking label. */
export function shouldShowRespondingActivity(
  isTextDelta: boolean,
  pendingToolCount: number,
  currentLabel: string,
): boolean {
  return isTextDelta && pendingToolCount === 0 && currentLabel !== 'Responding…'
}
