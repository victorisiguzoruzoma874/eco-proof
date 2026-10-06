import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const assets = new URL('../apps/dashboard/public/ai-chat/', import.meta.url);
let failOnce = true;
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    let body = ''; for await (const chunk of req) body += chunk;
    const { messages } = JSON.parse(body);
    if (req.url === '/api/retry' && failOnce) { failOnce = false; res.writeHead(503); res.end(); return; }
    if (req.url === '/api/interrupted') { res.writeHead(200, {'Content-Type':'text/event-stream'}); res.end('data: {"delta":"partial"}\n\n'); return; }
    if (req.url === '/api/actions') { res.writeHead(200, {'Content-Type':'text/event-stream'}); res.end('data: {"action":{"kind":"navigate","target":"wallet"},"label":"Open wallet"}\n\ndata: {"delta":"Ready for review"}\n\ndata: [DONE]\n\n'); return; }
    if (req.url === '/api/sse') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"type":"activity","label":"Reading demo context"}\r');
      setTimeout(() => { res.write('\n\r\ndata: {"type":"delta","text":"Streamed "}\n\n'); setTimeout(() => res.end('data: {"type":"delta","text":"answer"}\n\ndata: {"type":"done"}\n\n'), 50); }, 50);
    } else if (req.url === '/api/plain') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.write('Plain '); res.end('answer'); }
    else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: messages.length === 1 ? '<img src=x onerror=alert(1)> Safe reply' : 'Unexpected duplicate message' })); }
    return;
  }
  const name = req.url === '/' ? 'demo.html' : req.url.slice(1);
  if (!['demo.html', 'widget.js', 'robot.png', 'README.md'].includes(name)) { res.writeHead(404); res.end(); return; }
  try { res.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : name.endsWith('.png') ? 'image/png' : 'text/html'); res.end(await readFile(fileURLToPath(new URL(name, assets)))); }
  catch { res.writeHead(500); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const passed = name => console.log(`PASS ${name}`);
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base); await page.waitForFunction(() => customElements.get('proofchain-chat'));
  const widget = page.locator('proofchain-chat');
  const launcher = widget.locator('.launcher');
  assert.equal(await widget.locator('.robot').evaluate(img => img.complete && img.naturalWidth > 0), true);
  assert.equal(await widget.locator('.pose').evaluate(el => el.classList.contains('layered')), false);
  passed('original image loads and flat-image fallback is explicit');
  await page.mouse.move(1000, 100); await page.waitForTimeout(350);
  assert.notEqual(await widget.evaluate(el => el.pose.x), 0);
  assert.ok(await widget.evaluate(el => Math.abs(el.pose.x) <= 1 && Math.abs(el.pose.y) <= 1));
  passed('pointer tracking is relative and clamped');
  await page.evaluate(() => document.documentElement.dispatchEvent(new PointerEvent('pointerleave')));
  await page.waitForTimeout(650); assert.ok(await widget.evaluate(el => Math.abs(el.pose.x) < .01));
  await page.evaluate(() => window.scrollTo(0, 300)); await page.mouse.move(1100, 120); await page.waitForTimeout(250);
  const pose = await widget.evaluate(el => ({ actual: el.target.x, expected: Math.max(-1, Math.min(1, Math.tanh((1100 - el.shadowRoot.querySelector('.launcher').getBoundingClientRect().left - el.shadowRoot.querySelector('.launcher').getBoundingClientRect().width / 2) / Math.max(innerWidth * .8, 320)))) }));
  assert.ok(Math.abs(pose.actual - pose.expected) < .001); passed('pointer leave resets and scrolling preserves coordinates');
  await page.evaluate(() => { const b = document.querySelector('main button'); b.addEventListener('pointermove', e => e.stopPropagation()); b.id='stop-control'; });
  await page.locator('#stop-control').scrollIntoViewIfNeeded();
  const stopBox = await page.locator('#stop-control').boundingBox(); await page.mouse.move(stopBox.x+10,stopBox.y+10); await page.waitForTimeout(250);
  assert.ok(await widget.evaluate(el => el.pointer !== null)); passed('capture tracking over controls that stop propagation');
  await page.mouse.move(700,100); await page.waitForTimeout(250); const first=await widget.evaluate(el=>el.target.x);
  await page.mouse.move(1200,100); await page.waitForTimeout(250); assert.ok(await widget.evaluate(el=>el.target.x) > first); passed('distant positions continue changing the pose');
  await launcher.click(); assert.equal(await launcher.getAttribute('aria-expanded'), 'true');
  assert.equal(await widget.evaluate(el => el.shadowRoot.activeElement === el.shadowRoot.querySelector('input')), true);
  await widget.locator('input').fill('wallet'); await widget.locator('.send').click();
  await widget.locator('.message.assistant').filter({ hasText: 'Demo reply:' }).waitFor();
  assert.equal(await launcher.getAttribute('aria-expanded'), 'true'); passed('click opens, focuses input, and chat clicks do not toggle launcher');
  await page.keyboard.press('Escape'); assert.equal(await launcher.getAttribute('aria-expanded'), 'false');
  assert.equal(await widget.evaluate(el => el.shadowRoot.activeElement === el.shadowRoot.querySelector('.launcher')), true);
  await page.keyboard.press('Enter'); assert.equal(await launcher.getAttribute('aria-expanded'), 'true');
  await widget.locator('.close').click(); await page.keyboard.press('Space'); assert.equal(await launcher.getAttribute('aria-expanded'), 'true'); passed('Enter, Space, Escape, close, and focus restoration');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.mouse.move(700, 250);
  assert.deepEqual(await widget.evaluate(el => el.pose), { x: 0, y: 0 });
  assert.equal(await widget.locator('.float').evaluate(el => getComputedStyle(el).animationName), 'none'); passed('reduced motion disables tracking and floating');
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 700 });
    const box = await widget.locator('.panel').boundingBox(); assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= 701);
  }
  passed('mobile and tablet panel stays inside viewport');
  const touchPage = await browser.newPage({ viewport: { width: 390, height: 740 }, isMobile: true, hasTouch: true });
  await touchPage.goto(base); await touchPage.locator('proofchain-chat .launcher').tap();
  assert.equal(await touchPage.locator('proofchain-chat .launcher').getAttribute('aria-expanded'), 'true');
  await touchPage.mouse.move(300, 100); assert.deepEqual(await touchPage.locator('proofchain-chat').evaluate(el => el.pose), { x: 0, y: 0 }); passed('touch opens without pointer tracking');
  await touchPage.close();
  // Use independent instances to check transport contracts and isolation.
  for (const kind of ['json', 'sse', 'plain', 'retry', 'interrupted', 'actions']) {
    await page.evaluate(kind => { const el = document.createElement('proofchain-chat'); el.id = kind; el.setAttribute('endpoint', `/api/${kind}`); el.setAttribute('placement', 'right'); document.body.append(el); el.toggle(true); }, kind);
    const current = page.locator(`#${kind}`);
    await current.evaluate(el=>{el.performAction=async action=>{window.actionCalls=(window.actionCalls||0)+1;return 'Screen opened';};});
    await current.locator('input').fill('Hello'); await current.locator('.send').click();
    if (kind === 'retry') { await current.locator('.retry').waitFor(); await current.locator('.retry').click(); }
    if (kind === 'interrupted') { await current.locator('.retry').waitFor(); assert.equal(await current.locator('.message.assistant').filter({hasText:'partial'}).count(),0); await current.evaluate(el=>el.remove()); continue; }
    if (kind === 'actions') { await current.locator('.action:not([disabled])').waitFor(); assert.equal(await page.evaluate(()=>window.actionCalls||0),0); await current.locator('.action').click(); await current.locator('.status').filter({hasText:'Screen opened'}).waitFor(); assert.equal(await page.evaluate(()=>window.actionCalls),1); await current.evaluate(el=>el.remove()); continue; }
    const expected = kind === 'sse' ? 'Streamed answer' : kind === 'plain' ? 'Plain answer' : '<img src=x onerror=alert(1)> Safe reply';
    await current.locator('.message.assistant').filter({ hasText: expected }).waitFor();
    assert.equal(await current.locator('.history img').count(), 0);
    assert.equal(await current.evaluate(el => el.messages.filter(m => m.role === 'user').length), 1);
    await current.evaluate(el => { window.removedWidget = el; el.remove(); });
    assert.equal(await page.evaluate(() => removedWidget.lifecycle === null && removedWidget.frame === 0), true);
  }
  passed('JSON, chunked SSE, plain text, safe rendering, retry, isolation, and cleanup');
  await page.evaluate(() => {
    const el=document.createElement('robot-chat'); el.id='layer-test';
    const svg=content=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">${content}</svg>`);
    el.setAttribute('body-src',svg('<rect x="60" y="110" width="80" height="80" fill="white"/>'));
    el.setAttribute('head-src',svg('<rect x="40" y="20" width="120" height="80" rx="20" fill="navy"/>'));
    el.setAttribute('eyes-src',svg('<ellipse cx="80" cy="64" rx="8" ry="5" fill="cyan"/><ellipse cx="120" cy="64" rx="8" ry="5" fill="cyan"/>'));
    document.body.append(el);
  });
  const layered=page.locator('#layer-test'); await page.waitForFunction(()=>document.querySelector('#layer-test').layered);
  await page.emulateMedia({reducedMotion:'no-preference'}); await page.mouse.move(600,80); await page.waitForTimeout(250);
  assert.equal(await layered.locator('.body').evaluate(el=>el.style.transform),'');
  assert.ok((await layered.locator('.head').evaluate(el=>el.style.transform)).includes('rotateY'));
  assert.ok((await layered.locator('.eyes').evaluate(el=>el.style.transform)).includes('translate'));
  await layered.evaluate(el=>{clearTimeout(el.blinkTimer);el.blinkAnimation=el.shadowRoot.querySelector('.eyes').animate([{scale:'1 1'},{scale:'1 .03'},{scale:'1 1'}],{duration:200});});
  assert.equal(await layered.locator('.head').evaluate(el=>el.getAnimations().length),0);
  await layered.evaluate(el=>{window.removedLayer=el;el.remove();});
  assert.equal(await page.evaluate(()=>removedLayer.blinkAnimation.playState),'idle');
  passed('synthetic aligned layers: separate head, body, eyes, eye-only blink and cleanup (not original artwork)');
  await page.screenshot({ path: fileURLToPath(new URL('robot-widget-preview.png', assets)), fullPage: false });
  assert.deepEqual(errors, []); passed('no browser runtime errors');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
