// Browser-level voice lifecycle checks; speech events are mocked, no microphone is opened.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const widget = await readFile(new URL('../apps/dashboard/public/ai-chat/widget.js', import.meta.url));
const server = createServer((req, res) => {
  if (req.url === '/widget.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(widget); }
  else if (req.url === '/robot.png') { res.statusCode = 204; res.end(); }
  else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="en"><body><proofchain-chat endpoint="/assistant"></proofchain-chat><script src="/widget.js"></script></body></html>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.voiceSessions = [];
    class Recognition {
      constructor() { window.voiceSessions.push(this); }
      start() { this.onstart?.(); }
      stop() { this.stopped = true; }
      abort() { this.aborted = true; }
      result(parts) { this.onresult?.({ results: parts.map(text => [{ transcript: text }]) }); }
      end() { this.onend?.(); }
      error(code) { this.onerror?.({ error: code }); }
    }
    window.SpeechRecognition = Recognition;
  });
  let posted;
  await page.route('**/assistant', async route => {
    posted = route.request().postDataJSON();
    await route.fulfill({ json: { message: 'Your balance is 25 credits.' } });
  });
  await page.goto(origin);
  await page.locator('.launcher').click();
  const microphone = page.locator('.microphone');
  const input = page.locator('proofchain-chat input');
  const send = page.locator('.send');
  const status = page.locator('.status');

  await input.fill('Please');
  await microphone.click();
  assert.equal(await microphone.getAttribute('aria-pressed'), 'true');
  assert.equal(await send.isDisabled(), true);
  assert.equal(await input.evaluate(el => el.readOnly), true);
  await page.evaluate(() => window.voiceSessions.at(-1).result(['check my']));
  assert.equal(await input.inputValue(), 'Please check my');
  await page.evaluate(() => window.voiceSessions.at(-1).result(['check my balance', 'in credits']));
  assert.equal(await input.inputValue(), 'Please check my balance in credits');
  await microphone.click();
  assert.equal(await page.evaluate(() => window.voiceSessions.at(-1).stopped), true);
  await page.evaluate(() => { const r = window.voiceSessions.at(-1); r.result(['check my balance', 'in credits.']); r.end(); });
  assert.equal(await microphone.getAttribute('aria-pressed'), 'false');
  assert.equal(await send.isEnabled(), true);
  assert.match(await status.textContent(), /Transcribed/);
  assert.equal(posted, undefined, 'Dictation must not submit a draft');
  await send.click();
  await page.waitForFunction(() => document.querySelector('proofchain-chat').messages.at(-1)?.role === 'assistant');
  assert.equal(posted.messages.at(-1).content, 'Please check my balance in credits.');
  assert.match(await page.locator('.message.assistant').last().textContent(), /25 credits/);
  console.log('PASS live draft updates, final transcription and normal agent submission');

  await input.fill('Keep this draft');
  await microphone.click();
  await page.evaluate(() => window.voiceSessions.at(-1).error('not-allowed'));
  assert.match(await status.textContent(), /permission was denied/);
  assert.equal(await input.inputValue(), 'Keep this draft');
  assert.equal(await send.isEnabled(), true);
  await microphone.click();
  await page.evaluate(() => window.voiceSessions.at(-1).error('network'));
  assert.match(await status.textContent(), /could not connect/);
  assert.equal(await microphone.isEnabled(), true);
  console.log('PASS permission and network errors recover without losing typed text');

  await input.fill('');
  await microphone.click();
  await page.evaluate(() => window.voiceSessions.at(-1).end());
  assert.match(await status.textContent(), /No speech/);
  await microphone.click();
  await page.evaluate(() => window.voiceSessions.at(-1).result(['x'.repeat(4100)]));
  assert.equal((await input.inputValue()).length, 4000);
  await page.evaluate(() => window.voiceSessions.at(-1).end());
  assert.match(await status.textContent(), /limit reached/);
  console.log('PASS no-speech handling and message length limit');

  await input.fill('Draft');
  await microphone.click();
  await page.evaluate(() => { window.lateVoiceResult = window.voiceSessions.at(-1).onresult; });
  await page.locator('.close').click();
  assert.equal(await page.evaluate(() => window.voiceSessions.at(-1).aborted), true);
  await page.evaluate(() => window.lateVoiceResult({ results: [[{ transcript: 'stale words' }]] }));
  assert.equal(await input.inputValue(), 'Draft');
  await page.locator('.launcher').click();
  await microphone.click();
  await page.evaluate(() => document.querySelector('proofchain-chat').remove());
  assert.equal(await page.evaluate(() => window.voiceSessions.at(-1).aborted), true);
  console.log('PASS panel-close and unmount cleanup, including stale callbacks');

  await page.goto(origin);
  await page.locator('.launcher').click();
  await page.evaluate(() => { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; });
  await microphone.click();
  assert.match(await status.textContent(), /unavailable in this browser/);
  await input.fill('Typing still works');
  await send.click();
  await page.waitForFunction(() => document.querySelector('proofchain-chat').messages.at(-1)?.role === 'assistant');
  assert.equal(posted.messages.at(-1).content, 'Typing still works');
  console.log('PASS unsupported browser keeps text chat usable');

  await page.setViewportSize({ width: 320, height: 640 });
  const bounds = await page.locator('proofchain-chat form').evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth, inputWidth: el.querySelector('input').getBoundingClientRect().width }));
  assert.ok(bounds.content <= bounds.width, 'Composer should fit a narrow mobile viewport');
  assert.ok(bounds.inputWidth >= 70, 'Message input should remain usable');
  assert.deepEqual(pageErrors, []);
  console.log('PASS mobile composer layout and no browser errors');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
