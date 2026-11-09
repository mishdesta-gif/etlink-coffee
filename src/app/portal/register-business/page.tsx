import { FoundationShell,NotConfigured } from '@/components/foundation/shell';
import { BusinessForm } from '@/components/foundation/forms';
import { configured } from '@/lib/supabase/server';
import { workspace } from '@/lib/foundation/workspace';
export default async function RegisterBusiness(){if(!configured())return <FoundationShell title="Register your business."><NotConfigured/></FoundationShell>;await workspace();return <FoundationShell title="Register your business."><div className="foundation-card"><h2>One account. Independent businesses.</h2><p>Each application enters ET Link’s verification queue. Registration grants no staff permissions or automatic approval.</p><BusinessForm/></div></FoundationShell>;}
