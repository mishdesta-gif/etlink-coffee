import { test,expect } from '@playwright/test';

test('all marketing pages preserve responsive layout and approved brand assets',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  for(const width of [375,768,1440]){
    await page.setViewportSize({width,height:900});
    for(const route of ['/','/about','/for-buyers','/for-suppliers','/coffee-origins','/how-it-works','/contact']){
      const response=await page.goto(route);expect(response?.status()).toBe(200);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('h1')).toHaveCount(1);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      await page.locator('img').evaluateAll(images=>images.forEach(i=>{if(i instanceof HTMLImageElement)i.loading='eager';}));
      await expect.poll(()=>page.locator('img').evaluateAll(images=>images.every(i=>i instanceof HTMLImageElement&&i.complete&&i.naturalWidth>0))).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});
test('account screens fail closed without configuration and remain accessible at mobile widths',async({page})=>{
  for(const width of [375,1440]){
    await page.setViewportSize({width,height:900});
    for(const route of ['/auth/login','/auth/register','/auth/forgot','/auth/reset','/portal','/portal/team','/portal/security','/portal/register-business','/portal/invitations','/admin','/admin/verification','/admin/inquiries','/admin/audit','/admin/staff']){
      const response=await page.goto(route);expect(response?.status()).toBe(200);
      await expect(page.getByText('Account services await configuration.')).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      await expect(page.locator('h1')).toHaveCount(1);
      expect(response?.headers()['cache-control']).toContain('no-store');
    }
  }
  await page.goto('/auth/register');await expect(page.getByRole('button',{name:'Create account',exact:true})).toBeDisabled();
  await page.screenshot({path:'review/phase1-account-desktop.png',fullPage:true});
  await page.setViewportSize({width:375,height:812});await page.goto('/contact');await expect(page.getByRole('button',{name:'Send inquiry',exact:true})).toBeDisabled();
  await page.screenshot({path:'review/phase1-contact-mobile.png',fullPage:true});
});
test('private documents deny anonymous reads and security headers protect the app',async({request})=>{
  const document=await request.get('/api/documents/11111111-1111-4111-8111-111111111111');expect(document.status()).toBe(403);expect(document.headers()['cache-control']).toContain('no-store');
  const response=await request.get('/');expect(response.headers()['x-frame-options']).toBe('DENY');expect(response.headers()['x-content-type-options']).toBe('nosniff');expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect((await request.get('/auth/not-a-mode')).status()).toBe(404);
});
test('mobile menu and keyboard skip navigation still work',async({page})=>{
  await page.setViewportSize({width:375,height:812});await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('Tab');await expect(page.getByText('Skip to content')).toBeFocused();
  const button=page.locator('.menu-toggle');await button.click();await expect(button).toHaveAttribute('aria-expanded','true');await page.keyboard.press('Escape');await expect(button).toHaveAttribute('aria-expanded','false');await expect(button).toBeFocused();
});

test('guest account actions are visible across widths and audience registration links work', async ({page}) => {
  for (const width of [320, 375, 768, 1024, 1199, 1200, 1440]) {
    await page.setViewportSize({width,height:812});
    const response = await page.goto('/');
    const header = page.getByRole('banner');
    await expect(header.getByRole('link',{name:'Sign In',exact:true})).toBeInViewport();
    await expect(header.getByRole('link',{name:'Register',exact:true})).toBeInViewport();
    await expect(header.getByRole('navigation',{name:'Main navigation'})).toBeVisible({visible:width>=1200});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    expect(response?.headers()['cache-control']).toContain('no-store');
    expect(response?.headers()['x-robots-tag']).toBeUndefined();
    await page.evaluate(()=>window.scrollTo({top:500,behavior:'instant'}));
    expect((await header.boundingBox())?.y).toBe(0);
  }
  for (const [route,label] of [['/for-buyers','Register as a buyer'],['/for-suppliers','Register as a supplier or exporter']]) {
    await page.goto(route);
    await page.getByRole('link',{name:label}).click();
    await expect(page).toHaveURL('/auth/register');
  }
});
