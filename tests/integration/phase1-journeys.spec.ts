import {test,expect,type Page} from '@playwright/test';
const fixture='http://127.0.0.1:54329';
test.skip(process.env.ETLINK_PHASE1_JOURNEYS!=='true','Requires the explicitly isolated fake-only Phase 1 journey harness.');
const initialPassword='Synthetic-test-password-123!';
async function login(page:Page,address:string,password=initialPassword){
 await page.goto('/auth/login');await page.getByLabel('Email address').fill(address);await page.getByLabel('Password',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL('/portal');
}
async function confirmAccount(page:Page,address:string){
 await page.goto('/auth/register');await page.getByLabel('Email address').fill(address);await page.getByLabel('Password',{exact:true}).fill(initialPassword);
 await page.getByRole('button',{name:'Create account',exact:true}).click();await expect(page.getByRole('status')).toContainText('Check your email');
 const response=await page.request.post(fixture+'/_fixture/confirm',{data:{email:address}});expect(response.ok()).toBe(true);
 const {code}=await response.json();await page.goto('/auth/callback?code='+code);await expect(page).toHaveURL('/portal');
}
async function mfa(page:Page){
 await page.goto('/portal/security');await page.getByRole('button',{name:'Set up authenticator',exact:true}).click();
 await expect(page.getByAltText('Scan this QR code using your authenticator app')).toBeVisible();await page.reload();
 await page.getByLabel('Authenticator code').fill('000000');await page.getByRole('button',{name:'Verify MFA',exact:true}).click();
 await expect(page.getByText('Code could not be verified. Try a new code.')).toBeVisible();
 await page.getByLabel('Authenticator code').fill('123456');await page.getByRole('button',{name:'Verify MFA',exact:true}).click();
 await expect(page.getByText('MFA verified. Open the staff workspace to continue.')).toBeVisible();
}
test.beforeEach(async({context})=>{
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  return url.hostname==='127.0.0.1'&&['3102','54329'].includes(url.port)?route.continue():route.abort();
 });
});

test('full international buyer and Ethiopian supplier registration, independent MFA reviews and private document isolation',async({page,browser})=>{
 const staffContext=await browser.newContext();const staff=await staffContext.newPage();
 const supplierContext=await browser.newContext();const supplier=await supplierContext.newPage();
 try{
  await confirmAccount(page,'journey-buyer@example.test');
  await page.goto('/portal/register-business');await page.getByLabel('Business name',{exact:true}).fill('SYNTHETIC JOURNEY International Buyer');
  await page.getByLabel('Country',{exact:true}).fill('Germany');await page.getByLabel('Registration path').selectOption('overseas_buyer');
  await page.getByLabel('Business background and review information').fill('SYNTHETIC international buyer verification evidence.');
  await page.getByRole('button',{name:'Submit business application'}).click();await expect(page.getByRole('status')).toContainText('submitted for independent review');
  await page.goto('/portal');await expect(page.getByRole('heading',{level:1})).toHaveText('SYNTHETIC JOURNEY International Buyer');
  await expect(page.getByText('Your business is entitled to submit a buyer request before verification.',{exact:false})).toBeVisible();
  await expect(page.getByText('Purchase request submission is pending Phase 2.',{exact:false})).toBeVisible();
  await page.goto('/admin/verification');await expect(page.getByRole('heading',{level:1})).toHaveText('Staff access required.');
  await confirmAccount(supplier,'journey-supplier@example.test');
  await supplier.goto('/portal/register-business');await supplier.getByLabel('Business name',{exact:true}).fill('SYNTHETIC JOURNEY Ethiopian Supplier');
  await supplier.getByLabel('Country',{exact:true}).fill('Kenya');await supplier.getByLabel('Registration path').selectOption('exporter');
  await supplier.getByLabel('Initial capability').selectOption('supplier');await supplier.getByLabel('Business background and review information').fill('SYNTHETIC Ethiopian supplier evidence requiring independent review.');
  await supplier.getByRole('button',{name:'Submit business application'}).click();await expect(supplier.getByRole('status')).not.toContainText('submitted for independent review');
  await expect(supplier.getByRole('status')).not.toBeEmpty();
  await supplier.getByLabel('Business name',{exact:true}).fill('SYNTHETIC JOURNEY Ethiopian Supplier');
  await supplier.getByLabel('Country',{exact:true}).fill('Ethiopia');await supplier.getByLabel('Registration path').selectOption('exporter');
  await supplier.getByLabel('Initial capability').selectOption('supplier');await supplier.getByLabel('Business background and review information').fill('SYNTHETIC Ethiopian supplier evidence requiring independent review.');
  await supplier.getByRole('button',{name:'Submit business application'}).click();
  await expect(supplier.getByRole('status')).toContainText('submitted for independent review');await supplier.goto('/portal');
  await expect(supplier.getByText('Supplier lot submission requires current supplier approval',{exact:false})).toBeVisible();
  await supplier.getByLabel('Document label').fill('SYNTHETIC JOURNEY private evidence');
  await supplier.getByLabel('Document file').setInputFiles({name:'journey.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nSYNTHETIC isolated journey evidence')});
  await supplier.getByRole('button',{name:'Upload privately'}).click();await expect(supplier.getByText('Document uploaded privately.',{exact:false})).toBeVisible();
  const documentPath=await supplier.getByRole('link',{name:/SYNTHETIC JOURNEY private evidence/}).getAttribute('href');expect(documentPath).toMatch(/^\/api\/documents\//);
  expect((await supplier.request.get(documentPath!,{maxRedirects:0})).status()).toBe(303);
  expect((await page.request.get(documentPath!,{maxRedirects:0})).status()).toBe(404);
  const anonymous=await browser.newContext();try{expect((await anonymous.request.get('http://127.0.0.1:3102'+documentPath,{maxRedirects:0})).status()).toBe(403);}finally{await anonymous.close();}
  await login(staff,'reviewer@example.test');await staff.goto('/admin/verification');await expect(staff.getByRole('heading',{level:1})).toHaveText('Staff access required.');
  await mfa(staff);await staff.goto('/admin/verification');
  for(const name of ['SYNTHETIC JOURNEY International Buyer · buyer','SYNTHETIC JOURNEY Ethiopian Supplier · supplier']){
   const article=staff.locator('article').filter({has:staff.getByRole('heading',{name,exact:true})});
   await article.getByLabel('Review reason').fill('SYNTHETIC independent journey review started.');await article.getByRole('button',{name:'Record review decision'}).click();
   await expect(article.locator('.foundation-status')).toHaveText('under review');
   await article.getByLabel('Decision').selectOption('approved');await article.getByLabel('Review reason').fill('SYNTHETIC evidence checked; no trading enabled.');
   await article.getByLabel('Approval expiry').fill(new Date(Date.now()+180*86400000).toISOString().slice(0,10));await article.getByRole('button',{name:'Record review decision'}).click();
   await expect(article.locator('.foundation-status')).toHaveText('approved');
  }
  await supplier.goto('/portal');await expect(supplier.getByText('Supplier capability is currently approved.',{exact:false})).toBeVisible();
  await expect(supplier.getByText('Private lot submission will be available in Phase 2.',{exact:false})).toBeVisible();
  await page.goto('/portal');await expect(page.locator('.foundation-status').filter({hasText:/^approved$/}).first()).toBeVisible();
  await expect(page.getByText('A business verification decision is ready in your workspace.').first()).toBeVisible();
  await page.goto('/portal/trading/requests');await expect(page.getByText('Trading is unavailable on this deployment.',{exact:false})).toBeVisible();
  await page.request.post(fixture+'/_fixture/revoke-phase1-member',{data:{email:'journey-buyer@example.test'}});
  await page.goto('/portal');await expect(page.getByText('Register your first business.')).toBeVisible();
  expect((await page.request.get(documentPath!,{maxRedirects:0})).status()).toBe(404);
 } finally {await staffContext.close();await supplierContext.close();}
});

test('recovery PKCE, password change, old-password rejection, global session retirement and logout',async({page,browser})=>{
 await confirmAccount(page,'journey-recovery@example.test');
 const otherContext=await browser.newContext();const other=await otherContext.newPage();
 try{
  await login(other,'journey-recovery@example.test');
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page).toHaveURL('/auth/login');
  await other.goto('/portal');await expect(other).toHaveURL('/auth/login');
  await login(other,'journey-recovery@example.test');
  await page.goto('/auth/forgot');await page.getByLabel('Email address').fill('journey-recovery@example.test');await page.getByRole('button',{name:'Send recovery email'}).click();
  await expect(page.getByRole('status')).toContainText('If this address is registered');
  const response=await page.request.post(fixture+'/_fixture/recovery-code',{data:{email:'journey-recovery@example.test'}});expect(response.ok()).toBe(true);const {code}=await response.json();
  await page.goto('/auth/callback?code='+code+'&next=reset');await expect(page.getByRole('heading',{level:1})).toHaveText('Choose a new password.');
  await page.getByLabel('New password').fill('Synthetic-new-password-456!');await page.getByRole('button',{name:'Set new password'}).click();
  await expect(page.getByRole('status')).toContainText('Password updated. Sign in again');
  await page.goto('/portal');await expect(page).toHaveURL('/auth/login');await other.goto('/portal');await expect(other).toHaveURL('/auth/login');
  await page.getByLabel('Email address').fill('journey-recovery@example.test');await page.getByLabel('Password',{exact:true}).fill(initialPassword);await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Unable to sign in');
  await login(page,'journey-recovery@example.test','Synthetic-new-password-456!');
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page).toHaveURL('/auth/login');await page.goto('/portal');await expect(page).toHaveURL('/auth/login');
  await page.goto('/auth/callback?code='+code+'&next=reset');await expect(page).toHaveURL('/auth/login?notice=invalid-link');await expect(page.locator('aside[role="alert"]')).toContainText('invalid, expired or already used');
 }finally{await otherContext.close();}
});

test('invalid PKCE and arbitrary callback next cannot navigate to an external destination',async({page})=>{
 await page.goto('/auth/callback?code=synthetic-invalid&next=https://example.invalid');
 await expect(page).toHaveURL('/auth/login?notice=invalid-link');await expect(page.locator('aside[role="alert"]')).toContainText('invalid, expired or already used');
});

test('recovery previews do not consume tokens; explicit confirmation preserves PKCE and rejects reuse',async({page})=>{
 await page.goto('/auth/forgot');await page.getByLabel('Email address').fill('alice@example.test');await page.getByRole('button',{name:'Send recovery email'}).click();
 await expect(page.getByRole('status')).toContainText('If this address is registered');
 const created=await page.request.post(fixture+'/_fixture/recovery-link',{data:{email:'alice@example.test'}});expect(created.ok()).toBe(true);
 const {confirmationUrl}=await created.json();const landing='/auth/recovery/confirm?confirmation_url='+encodeURIComponent(confirmationUrl);
 const before=await (await page.request.get(fixture+'/_fixture/recovery-stats')).json();
 const previewHeaders:Record<string,string>[]=[{},{Purpose:'prefetch'},{'Sec-Purpose':'prefetch;prerender'}];
 for(const headers of previewHeaders){
  const response=await page.request.get(landing,{headers});expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toContain('no-store');expect(response.headers()['referrer-policy']).toBe('no-referrer');
 }
 expect((await page.request.head(landing)).status()).toBe(200);
 expect((await page.request.get('/auth/recovery/continue',{maxRedirects:0})).status()).toBe(405);
 const denied=await page.request.post('/auth/recovery/continue',{headers:{Origin:'https://evil.invalid'},form:{confirmation_url:confirmationUrl},maxRedirects:0});expect(denied.status()).toBe(403);
 await page.goto(landing);await expect(page.getByRole('button',{name:'Continue password recovery',exact:true})).toBeVisible();
 expect((await (await page.request.get(fixture+'/_fixture/recovery-stats')).json()).recoveryVerifications).toBe(before.recoveryVerifications);
 await page.getByRole('button',{name:'Continue password recovery',exact:true}).click();await expect(page).toHaveURL('/auth/reset');await expect(page.getByRole('heading',{level:1})).toHaveText('Choose a new password.');
 expect((await (await page.request.get(fixture+'/_fixture/recovery-stats')).json()).recoveryVerifications).toBe(before.recoveryVerifications+1);
 await page.goto(landing);await page.getByRole('button',{name:'Continue password recovery',exact:true}).click();await expect(page).toHaveURL('/auth/login?notice=invalid-link');
 await page.goto('/auth/recovery/confirm?confirmation_url='+encodeURIComponent('https://evil.invalid/auth/v1/verify'));
 await expect(page.locator('aside[role="alert"]')).toContainText('invalid');await expect(page.getByRole('button',{name:'Continue password recovery',exact:true})).toHaveCount(0);
});

test('recovery confirmation rejects synthetic expired links and a different browser without PKCE',async({page,browser})=>{
 for(const expired of [true,false]){
  await page.goto('/auth/forgot');await page.getByLabel('Email address').fill('bob@example.test');await page.getByRole('button',{name:'Send recovery email'}).click();await expect(page.getByRole('status')).toContainText('If this address is registered');
  const created=await page.request.post(fixture+'/_fixture/recovery-link',{data:{email:'bob@example.test',expired}});const {confirmationUrl}=await created.json();
  const other=expired?null:await browser.newContext();const target=other?await other.newPage():page;
  try{
   await target.goto('http://127.0.0.1:3102/auth/recovery/confirm?confirmation_url='+encodeURIComponent(confirmationUrl));
   await target.getByRole('button',{name:'Continue password recovery',exact:true}).click();await expect(target).toHaveURL('http://127.0.0.1:3102/auth/login?notice=invalid-link');
  }finally{await other?.close();}
 }
});

test('logout service failure reports incomplete retirement and removes local workspace access',async({page})=>{
 await login(page,'alice@example.test');await page.request.post(fixture+'/_fixture/phase1-control',{data:{failLogout:true}});
 try{
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page).toHaveURL('/auth/login?notice=signout-incomplete');
  await expect(page.locator('aside[role="alert"]')).toContainText('could not be completed for all sessions');await page.goto('/portal');await expect(page).toHaveURL('/auth/login');
 }finally{await page.request.post(fixture+'/_fixture/phase1-control',{data:{failLogout:false}});}
});

test('private team invitation, viewer restrictions and owner membership revocation work through the application',async({page,browser})=>{
 const viewerContext=await browser.newContext();const viewer=await viewerContext.newPage();
 try{
  await confirmAccount(viewer,'journey-viewer@example.test');await login(page,'alice@example.test');await page.goto('/portal/team');
  await page.getByLabel('Invitee email').fill('journey-viewer@example.test');await page.getByLabel('Team role').selectOption('viewer');
  await page.getByRole('button',{name:'Create private invitation'}).click();await expect(page.getByRole('status').last()).toContainText('Invitation created');
  const invitation=await page.getByLabel('Copy private invitation link').inputValue();expect(new URL(invitation).origin).toBe('http://127.0.0.1:3102');
  await viewer.goto(invitation);await viewer.getByRole('button',{name:'Accept invitation',exact:true}).click();await expect(viewer.getByRole('status')).toContainText('Invitation accepted');
  await viewer.goto('/portal');await expect(viewer.getByRole('heading',{level:1})).toHaveText('SYNTHETIC — Guji Importer');
  await expect(viewer.getByRole('button',{name:'Upload privately'})).toHaveCount(0);await expect(viewer.getByRole('button',{name:'Submit capability for review'})).toHaveCount(0);
  await viewer.goto('/portal/team');await expect(viewer.getByRole('button',{name:'Create private invitation'})).toHaveCount(0);
  await page.reload();const member=page.locator('article').filter({has:page.getByRole('heading',{name:'viewer · Active',exact:true})});
  const memberId=await member.locator('input[name="user_id"]').inputValue();
  const stableMember=page.locator('article').filter({has:page.locator(`input[name="user_id"][value="${memberId}"]`)});
  await stableMember.getByLabel('Active membership').uncheck();await stableMember.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(stableMember.getByRole('heading',{name:'viewer · Inactive',exact:true})).toBeVisible();await expect(stableMember.getByRole('status')).toContainText('saved');
  await viewer.goto('/portal');await expect(viewer.getByText('Register your first business.')).toBeVisible();
 }finally{await viewerContext.close();}
});

test('staff permission revocation immediately denies an existing MFA session and retains audit evidence',async({page})=>{
 await login(page,'reviewer@example.test');await mfa(page);await page.goto('/admin/verification');await expect(page.getByRole('heading',{level:1})).toHaveText('Verification center');
 await page.request.post(fixture+'/_fixture/revoke-phase1-reviewer');await page.reload();await expect(page.getByRole('heading',{level:1})).toHaveText('Staff access required.');
 const state=await (await page.request.get(fixture+'/_fixture/phase1-state')).json();expect(state.audit_events).toBeGreaterThan(0);expect(state.verification_events).toBeGreaterThan(0);expect(state.enabled_emails).toBe(0);expect(state.externalEmailsSent).toBe(0);expect(state.tradingEnabled).toBe(false);
});
