import { FoundationShell,NotConfigured } from '@/components/foundation/shell';
import { MfaForm } from '@/components/foundation/auth-form';
import { configured } from '@/lib/supabase/server';
import { workspace } from '@/lib/foundation/workspace';
export default async function Security(){if(!configured())return <FoundationShell title="Account security."><NotConfigured/></FoundationShell>;await workspace();return <FoundationShell title="Account security."><MfaForm/></FoundationShell>;}
