import { FoundationShell,NotConfigured } from '@/components/foundation/shell';
import { AcceptInvitation } from '@/components/foundation/forms';
import { configured } from '@/lib/supabase/server';
import { workspace } from '@/lib/foundation/workspace';
export default async function Invitations(){if(!configured())return <FoundationShell title="Accept a private invitation."><NotConfigured/></FoundationShell>;await workspace();return <FoundationShell title="Accept a private invitation."><div className="foundation-card"><AcceptInvitation/></div></FoundationShell>;}
