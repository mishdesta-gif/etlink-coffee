// Only these deliberately authored errors may be serialized by trading actions.
export class TradingInputError extends Error {}

export function calendarDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0,4)) < 1) throw new TradingInputError('Select a valid calendar date.');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value) throw new TradingInputError('Select a valid calendar date.');
  return value;
}
