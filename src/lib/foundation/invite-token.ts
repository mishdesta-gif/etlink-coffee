// Supabase Auth emits a hexadecimal SHA-224 hash for admin invitations.
export function isInviteTokenHash(value: string): boolean {
  return /^[a-f0-9]{56}$/i.test(value);
}
