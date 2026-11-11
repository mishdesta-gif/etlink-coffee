// PostgreSQL numeric amounts arrive as decimal strings. Keep subtraction exact
// at the ledger's six-decimal precision, including values beyond JS safe integers.
export function outstandingAmount(amount:string,paid:string):string {
  function scaled(value:string) {
    if (!/^\d{1,24}(?:\.\d{1,6})?$/.test(value)) throw new Error('Invalid ledger amount.');
    const [whole,fraction=''] = value.split('.');
    return BigInt(whole) * BigInt(1000000) + BigInt(fraction.padEnd(6,'0'));
  }
  const remaining = scaled(amount) - scaled(paid);
  if (remaining < BigInt(0)) throw new Error('Invalid ledger balance.');
  const whole = remaining / BigInt(1000000);
  const fraction = (remaining % BigInt(1000000)).toString().padStart(6,'0').replace(/0+$/,'');
  return whole.toString() + (fraction ? '.' + fraction : '');
}
