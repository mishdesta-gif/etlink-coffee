/** Only deliberately authored messages may cross an action boundary. */
export class SafeActionError extends Error {}

export function safeActionMessage(error: unknown, fallback: string, area: 'authentication'|'workspace'|'inquiry'): string {
  if (error instanceof SafeActionError) return error.message;
  // Never serialize an exception, stack, code, input, identity or provider response.
  // Fixed categories preserve a useful server-side signal without confidential payloads.
  try { console.error('ETLINK_ACTION_FAILURE', { area, category:'unexpected_exception' }); } catch { /* Logging cannot break safe error handling. */ }
  return fallback;
}

export function verificationExpiry(value: unknown): string | null {
  if (value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0,4)) < 1) throw new SafeActionError('Select a valid expiration date.');
  const date = new Date(`${value}T23:59:59.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) throw new SafeActionError('Select a valid expiration date.');
  return date.toISOString();
}

export function field(data: FormData, name: string, min = 1, max = 160): string {
  const raw = data.get(name);
  if (typeof raw !== 'string' || raw.trim().length < min || raw.trim().length > max || raw.includes('\0')) throw new SafeActionError(`Please check ${name.replaceAll('_', ' ')} (${min}–${max} characters).`);
  return raw.trim();
}
export function choice<T extends string>(value: string, choices: readonly T[]): T {
  if (!choices.includes(value as T)) throw new SafeActionError('Please select a valid option.');
  return value as T;
}
export function email(value: string): string {
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new SafeActionError('Please enter a valid email address.');
  return value.toLowerCase();
}
export function uuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new SafeActionError('Please select a valid record.');
  return value;
}
export function integer(value: string, min = 1, max = 2147483647): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new SafeActionError('Please enter a valid number.');
  return n;
}
export function password(value: FormDataEntryValue | null): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) throw new SafeActionError('Use a password between 12 and 128 characters.');
  return value;
}
export function validateDocument(bytes: Uint8Array, mime: string): void {
  if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024) throw new SafeActionError('Documents must be between 1 byte and 5 MB.');
  const pdf = mime === 'application/pdf' && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-';
  const png = mime === 'image/png' && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v);
  const jpeg = mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!pdf && !png && !jpeg) throw new SafeActionError('Use a valid PDF, PNG, or JPEG document.');
}
export async function documentHash(bytes:Uint8Array):Promise<string> {
  const digest=await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
}
export async function validateStoredDocument(file:Blob,expected:{mime:string;bytes:number;sha256:string}):Promise<void> {
  if(file.size!==expected.bytes||file.size<1||file.size>5242880||file.type.split(';')[0].trim().toLowerCase()!==expected.mime)throw new SafeActionError('Stored document does not match the prepared upload.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  validateDocument(bytes,expected.mime);
  if(await documentHash(bytes)!==expected.sha256)throw new SafeActionError('Stored document content does not match the prepared upload.');
}
export const businessKinds = ['overseas_buyer','domestic_buyer','farmer','cooperative','trader','exporter','exporter_sourcing'] as const;
export const capabilities = ['buyer','supplier'] as const;
export const teamRoles = ['admin','trader','operations','viewer'] as const;
export const permissions = ['staff.manage','verification.review','inquiry.manage','audit.read'] as const;
export type ActionState = { ok: boolean; message: string; link?: string; qr?: string; factorId?: string };
export const initialState: ActionState = { ok: false, message: '' };
