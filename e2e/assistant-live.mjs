// Live Railway + Vercel check. Creates and deletes only its own zero-balance fixture.
// Requires Railway CLI login; secrets and session tokens stay in process memory.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const cli = process.platform === 'win32' ? 'railway.cmd' : 'railway';
const vars = JSON.parse(execFileSync(cli, ['variable', 'list', '--json'], {
  encoding: 'utf8', shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'],
}));
const backend = `https://${vars.RAILWAY_PUBLIC_DOMAIN}`;
const dashboard = process.env.ASSISTANT_TEST_DASHBOARD || 'https://eco-proof-dashboard-psi.vercel.app';
const email = `assistant-verify-${randomUUID()}@example.invalid`;
let fixtureId, browser;
const databaseUrl = new URL(vars.DATABASE_URL);
databaseUrl.searchParams.set('sslmode', 'verify-full');
const db = new pg.Client({ connectionString: databaseUrl.href });
const pass = label => console.log(`PASS ${label}`);
try {
  await db.connect();
  const health = await (await fetch(`${backend}/health`)).json();
  assert.equal(health.database, 'up'); pass('Railway database health');
  const unauthorized = await fetch(`${backend}/api/v1/assistant`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({messages:[{role:'user',content:'Hello'}]}) });
  assert.equal(unauthorized.status, 401); pass('assistant requires authentication');
  const registration = await fetch(`${backend}/requesters/register`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:'Temporary assistant verification',email,password:randomUUID()+randomUUID()}),
  });
  assert.equal(registration.status,201);
  const session=await registration.json(); fixtureId=session.requester.id;
  assert.match(fixtureId,/^[0-9a-f-]{36}$/);
  const response=await fetch(`${backend}/api/v1/assistant`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.accessToken}`},
    body:JSON.stringify({messages:[{role:'user',content:'Use get_balance to check my actual wallet balance. Say the balance in credits.'}]}),signal:AbortSignal.timeout(55000),
  });
  assert.equal(response.status,200);
  const stream=await response.text();
  assert.ok(stream.includes('[DONE]') && stream.includes('"activity"') && !stream.includes('"error"'));
  const events=stream.split('\n').filter(l=>l.startsWith('data: {')).map(l=>JSON.parse(l.slice(6)));
  assert.match(events.map(e=>e.delta||'').join(''),/\b0\b|zero/i);
  pass('live DeepSeek tool-backed answer through Railway (zero-balance test account)');
  browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.context().addCookies([{name:'proofchain_requester_token',value:session.accessToken,url:dashboard,httpOnly:true,secure:new URL(dashboard).protocol === 'https:',sameSite:'Lax'}]);
  await page.goto(`${dashboard}/requester/dashboard`);
  assert.equal(new URL(page.url()).pathname,'/requester/dashboard');
  await page.locator('proofchain-chat .launcher').click();
  await page.locator('proofchain-chat input').fill('Use open_screen to offer me a button to open my wallet.');
  await page.locator('proofchain-chat .send').click();
  await page.locator('proofchain-chat .action:not([disabled])').waitFor({timeout:60000});
  assert.equal(new URL(page.url()).pathname,'/requester/dashboard');
  await page.locator('proofchain-chat .action').click();
  await page.waitForURL('**/requester/wallet',{timeout:15000});
  await page.locator('proofchain-chat .status').filter({hasText:'Application screen opened.'}).waitFor();
  pass('dashboard session bridge, live streamed reply, click-gated task and confirmed wallet navigation');
  if (process.env.ASSISTANT_TEST_WORKFLOWS === '1') {
    let submissions = 0;
    page.on('request', req => { if (req.method() === 'POST' && req.headers()['next-action']) submissions++; });
    const hub = (await db.query('SELECT id FROM hubs ORDER BY code LIMIT 1')).rows[0];
    const material = (await db.query('SELECT code FROM materials WHERE active=true ORDER BY "sortOrder" LIMIT 1')).rows[0];
    assert.ok(hub && material, 'A real hub and active material are required for this check.');
    const draft = {kind:'review-pickup',hubId:hub.id,material:material.code,estimatedWeightKg:5.345,address:'12 Verification Road',notes:'Use gate B exactly.'};
    const invoke = action => page.locator('proofchain-chat').evaluate((widget, action) => widget.performAction(action), action);
    if (process.env.ASSISTANT_TEST_NEW_TOOLS === '1') {
      await page.locator('proofchain-chat input').fill('Use prepare_claim to prepare ABCDEFGH for review. Do not redeem it.');
      await page.locator('proofchain-chat .send').click();
      const review = page.locator('proofchain-chat .action:not([disabled])').filter({hasText:'Review claim code'});
      await review.waitFor({timeout:60000});
      await review.click();
      await page.locator('proofchain-chat .status').filter({hasText:'Review form opened'}).waitFor();
      assert.equal(await page.locator('#redemptionCode').inputValue(),'ABCDEFGH');
      pass('live expanded prepare_claim tool, SSE action, click and exact form prefill');
    }
    await invoke(draft);
    assert.equal(await page.locator('#hubId').inputValue(),hub.id);
    assert.equal(await page.locator(`input[name="material-${material.code}"]`).inputValue(),'5.345');
    assert.equal(await page.locator('#address').inputValue(),draft.address);
    assert.equal(await page.locator('#notes').inputValue(),draft.notes);
    assert.ok(!page.url().includes('Verification') && !page.url().includes('gate'));
    await page.locator('#address').fill('Edited by user');
    await page.locator('#notes').fill('User instructions');
    await invoke({...draft,estimatedWeightKg:2.125,address:'Second Verification Road',notes:'New instruction'});
    assert.equal(await page.locator('#address').inputValue(),'Second Verification Road');
    assert.equal(await page.locator(`input[name="material-${material.code}"]`).inputValue(),'2.125');
    pass('pickup review preserves exact hub, material, three-decimal weight, address and notes; new drafts refresh');
    await invoke({kind:'review-claim',code:'ABCDEFGH'});
    assert.equal(await page.locator('#redemptionCode').inputValue(),'ABCDEFGH');
    assert.ok(!page.url().includes('ABCDEFGH'));
    await invoke({kind:'review-withdrawal',amountCredits:1.234});
    assert.equal(await page.locator('#amountCredits').inputValue(),'1.234');
    await invoke({kind:'set-theme',theme:'dark'});
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    await page.locator('.rq-theme-toggle').filter({hasText:'Light mode'}).waitFor();
    await invoke({kind:'set-theme',theme:'light'});
    await page.locator('.rq-theme-toggle').filter({hasText:'Dark mode'}).waitFor();
    await assert.rejects(()=>invoke({kind:'navigate',target:'https://evil.test'}));
    const reward=(await db.query('SELECT id FROM catalog_items WHERE active=true ORDER BY name LIMIT 1')).rows[0];
    if(reward){await invoke({kind:'review-reward',itemId:reward.id});await page.locator(`#reward-${reward.id}`).filter({hasText:'Nothing has been redeemed'}).waitFor();pass('reward review opens the existing item form without spending');}
    assert.equal(submissions,0,'Review callbacks must never submit a form.');
    const requests=await db.query('SELECT count(*)::int AS count FROM collection_requests WHERE "requesterId"=$1',[fixtureId]);
    const rewards=await db.query('SELECT count(*)::int AS count FROM catalog_redemptions WHERE "requesterId"=$1',[fixtureId]);
    const withdrawals=await db.query('SELECT count(*)::int AS count FROM withdrawal_requests WHERE "requesterId"=$1',[fixtureId]);
    assert.equal(requests.rows[0].count,0);assert.equal(rewards.rows[0].count,0);assert.equal(withdrawals.rows[0].count,0);
    pass('claim/withdrawal review, synchronized theme, invalid navigation rejection and no submissions/writes');
  }
} finally {
  await browser?.close();
  if(fixtureId) {
    await db.query('BEGIN');
    try {
      // Exact unique fixture only; never touch a pre-existing account or ledger.
      const own=await db.query('SELECT id FROM requesters WHERE id=$1 AND email=$2 AND name=$3 FOR UPDATE',[fixtureId,email,'Temporary assistant verification']);
      assert.equal(own.rowCount,1);
      await db.query('DELETE FROM waste_wallets WHERE "requesterId"=$1',[fixtureId]);
      await db.query('DELETE FROM requesters WHERE id=$1 AND email=$2',[fixtureId,email]);
      await db.query('COMMIT'); pass('temporary account and empty wallet removed');
    } catch(error) { await db.query('ROLLBACK'); console.error(`Fixture cleanup needs attention: ${fixtureId}, ${email}`); throw error; }
  }
  await db.end();
}
