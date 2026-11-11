import { expect, type Page } from '@playwright/test';

export async function fulfillmentJourney(buyer:Page,supplier:Page,admin:Page) {
  await admin.goto('/admin/trading');
  const match = admin.locator('article.foundation-card').filter({has:admin.getByRole('heading',{name:/^MAT-/})});
  await match.getByText('Issue confidential quote',{exact:true}).click();
  const supplierQuote = match.locator('form').filter({has:admin.getByRole('button',{name:'Issue private quote',exact:true})});
  await supplierQuote.getByLabel('Recipient business').selectOption({index:1});
  await supplierQuote.getByLabel('Quote quantity (kg)').fill('1000');
  await supplierQuote.getByLabel('Quote price per kg').fill('5');
  await supplierQuote.getByLabel('Valid until (UTC, at most 30 days)').fill(new Date(Date.now()+86400000).toISOString().slice(0,10));
  await supplierQuote.getByRole('button',{name:'Issue private quote',exact:true}).click();
  await supplierQuote.getByRole('status').filter({hasText:'Recorded privately.'}).waitFor();
  await supplier.goto('/portal/trading/offers');
  await supplier.getByRole('button',{name:'Indicate interest',exact:true}).click();
  await supplier.getByText('Recorded response: interested. ET Link will review; no reservation.',{exact:true}).waitFor();

  await buyer.goto('/portal/trading/offers');
  await buyer.getByText('Request a physical coffee sample',{exact:true}).click();
  await buyer.getByRole('button',{name:'Request physical sample',exact:true}).click();
  await buyer.getByRole('status').filter({hasText:'Marketplace status updated.'}).waitFor();
  await admin.goto('/admin/operations');
  let sample = admin.locator('article.foundation-card').filter({has:admin.getByRole('heading',{name:/^SMP-/})});
  await sample.getByLabel('Private carrier').fill('SYNTHETIC ET Link relay');
  await sample.getByLabel('Private tracking reference').fill('SYNTHETIC-PRIVATE-TRACKING');
  await sample.getByRole('button',{name:'Record sample logistics',exact:true}).click();
  await sample.getByRole('status').filter({hasText:'Marketplace status updated.'}).waitFor();
  for (const status of ['received','accepted']) {
    await buyer.goto('/portal/trading/operations');
    const buyerSample = buyer.locator('article.foundation-card').filter({has:buyer.getByRole('heading',{name:/^SMP-/})});
    await buyerSample.getByLabel('Sample response').selectOption(status);
    await buyerSample.getByRole('button',{name:'Record sample response',exact:true}).click();
    await expect(buyerSample.locator('.foundation-status')).toContainText(status);
  }
  await admin.goto('/admin/operations');
  sample = admin.locator('article.foundation-card').filter({has:admin.getByRole('heading',{name:/^SMP-/})});
  await sample.getByLabel('Allocation quantity (kg)').fill('1000');
  await sample.getByRole('button',{name:'Allocate stock separately',exact:true}).click();
  await sample.getByRole('status').filter({hasText:'Marketplace status updated.'}).waitFor();
  await admin.reload();
  const allocation = admin.locator('article.foundation-card').filter({has:admin.getByRole('heading',{name:/^ALC-/})});
  await expect(allocation.getByText(/0 kg under active reservation/)).toBeVisible();
  await allocation.getByLabel('Reserve until (UTC)').fill(new Date(Date.now()+86400000).toISOString().slice(0,10));
  await allocation.getByRole('button',{name:'Create timed reservation',exact:true}).click();
  await allocation.getByRole('status').filter({hasText:'Marketplace status updated.'}).waitFor();
  await admin.reload();
  const reservation = admin.locator('article.foundation-card').filter({has:admin.getByRole('heading',{name:/^RSV-/})});
  await reservation.getByLabel('Buyer private quote').selectOption({index:1});
  await reservation.getByLabel('Supplier private quote').selectOption({index:1});
  await reservation.getByRole('button',{name:'Create private deal record',exact:true}).click();
  await expect(admin.getByRole('heading',{name:/^DEAL-/})).toBeVisible();
  for (const page of [buyer,supplier]) {
    await page.goto('/portal/trading/operations');
    expect(await page.content()).not.toContain('SYNTHETIC-PRIVATE-TRACKING');
    const deal = page.locator('article.foundation-card').filter({has:page.getByRole('heading',{name:/^DEAL-/})});
    await expect(deal.getByText(new RegExp(page===buyer?'Your recorded price 6.75 USD/kg':'Your recorded price 5 USD/kg'))).toBeVisible();
    await deal.getByRole('checkbox').check();
    await deal.getByRole('button',{name:'Confirm my business terms',exact:true}).click();
    await page.getByText('Your business has confirmed these terms. ET Link will check both confirmations before advancing.',{exact:true}).waitFor();
  }
  async function advance(status:string) {
    await admin.goto('/admin/operations');
    const deal = admin.locator('article.foundation-card').filter({has:admin.getByRole('heading',{name:/^DEAL-/})});
    await deal.getByLabel('Next milestone').selectOption(status);
    await deal.getByLabel('Private evidence reference').fill('SYNTHETIC-PRIVATE-MILESTONE');
    await deal.getByRole('button',{name:'Record deal milestone',exact:true}).click();
    await expect(deal.locator('.foundation-status')).toContainText(status.replaceAll('_',' '));
  }
  for (const status of ['confirmed','contract_signed','in_transit','delivered']) await advance(status);
  for (const page of [buyer,supplier]) {
    await page.goto('/portal/trading/operations');
    const deal = page.locator('article.foundation-card').filter({has:page.getByRole('heading',{name:/^DEAL-/})});
    await deal.getByRole('checkbox').check();
    await deal.getByRole('button',{name:'Confirm delivery for my business',exact:true}).click();
    await page.getByText('Your business has confirmed delivery.',{exact:true}).waitFor();
  }
  await advance('completed');
  await admin.goto('/admin/operations');
  const fee = admin.locator('article.foundation-card').filter({has:admin.getByRole('heading',{name:/^FEE-/})});
  await fee.getByLabel('Received amount (USD)').fill('337.5');
  await fee.getByLabel('External payment reference').fill('SYNTHETIC-BROWSER-PAYMENT-001');
  await fee.getByRole('button',{name:'Record received commission payment',exact:true}).click();
  await expect(fee.getByText(/Outstanding 0/)).toBeVisible();
  for (const page of [buyer,supplier]) {
    await page.goto('/portal/trading/operations');
    await expect(page.locator('.foundation-status').filter({hasText:'completed'})).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain('SYNTHETIC-PRIVATE-MILESTONE');
    expect(html).not.toContain(page===buyer?'SYNTHETIC — Ethiopian Supplier':'SYNTHETIC — Guji Importer');
    if (page===buyer) await expect(page.getByText(/Outstanding 0 USD/)).toBeVisible();
    await page.setViewportSize({width:390,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
}
