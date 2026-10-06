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
  await page.context().addCookies([{name:'proofchain_requester_token',value:session.accessToken,url:dashboard,httpOnly:true,secure:true,sameSite:'Lax'}]);
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
  pass('Vercel session bridge, live streamed reply, click-gated task and confirmed wallet navigation');
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
