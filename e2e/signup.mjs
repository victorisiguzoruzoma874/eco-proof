import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/**
 * Sign-up, end to end: a stranger asks to join as a collector and as an
 * operator, neither can do anything until staff approve, and approval turns
 * each into the real thing.
 *
 * Needs the in-memory backend (seeded hubs and the dev admin) and the
 * dashboard pointed at it:
 *
 *   npm run dev:backend:inmemory
 *   npm run dev:dashboard
 *   node e2e/signup.mjs
 *
 * Every run uses a fresh phone and email, so it can be repeated against the
 * same server.
 */

const SHOTS = process.env.SHOTS_DIR ?? "./e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

const DASH = process.env.DASH_URL ?? "http://localhost:3001";
const ADMIN = { email: "admin@proofchain.local", password: "admin-dev-password" };
const AUDITOR = { email: "auditor@proofchain.local", password: "auditor-dev-password" };
const STAFF_OPERATOR = { email: "operator@proofchain.local", password: "operator-dev-password" };

const run = Date.now().toString().slice(-8);
const collector = { name: `Amina Bello ${run}`, phone: `+23480${run}` };
const operator = {
  name: `Tunde Okafor ${run}`,
  phone: `+23481${run}`,
  email: `tunde.${run}@example.com`,
  password: "correct horse battery",
};
const rejected = { name: `Reject Me ${run}`, phone: `+23482${run}` };

const results = [];
const consoleErrors = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

const bodyText = () => page.locator("body").innerText();

async function signIn({ email, password }) {
  await page.goto(`${DASH}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  // Either through to the dashboard, or back on /login with the error shown.
  await Promise.all([
    page.waitForURL((url) => url.pathname !== "/login" || url.search.includes("error")),
    page.click('main button[type="submit"]'),
  ]);
  // The URL changes before the page behind it has rendered.
  if (new URL(page.url()).pathname === "/login") await page.waitForSelector("main .error");
  else await page.waitForLoadState("networkidle");
}

async function signOut() {
  await page.context().clearCookies();
}

async function submitCollector(person) {
  await page.goto(`${DASH}/signup?role=collector`, { waitUntil: "networkidle" });
  await page.fill('input[name="name"]', person.name);
  await page.fill('input[name="phone"]', person.phone);
  await page.selectOption('select[name="hubId"]', { index: 1 });
  await submitSignupForm();
}

/** Submit, then wait for the page the server action redirects to. */
async function submitSignupForm() {
  await Promise.all([
    page.waitForURL((url) => url.search.includes("done=") || url.search.includes("error=")),
    page.click('main button[type="submit"]'),
  ]);
  // The URL changes before the new page has rendered.
  await page.waitForSelector(".signup-done, .signup-form .error");
}

// ------------------------------------------------------------ 1. the way in
console.log("\n[1] The sign-in page offers sign-up");
await page.goto(`${DASH}/login`, { waitUntil: "networkidle" });
const link = page.locator('a[href="/signup"]', { hasText: "Create an account" });
check("sign-in page has a Create an account link", (await link.count()) === 1);
await page.screenshot({ path: `${SHOTS}/signup-01-login-link.png`, fullPage: true });
await Promise.all([page.waitForURL(/\/signup/), link.click()]);
await page.waitForLoadState("networkidle");

// ------------------------------------------------------------ 2. the page
console.log("\n[2] The sign-up page");
let text = await bodyText();
check("welcome panel names the product", text.includes("Join ProofChain"));
check(
  "welcome panel explains both roles",
  text.includes("bring in materials and get paid by weight") &&
    text.includes("weigh, record and manage collections at a hub"),
);
check("says accounts are reviewed", text.includes("Every account is reviewed before it goes live."));
check("collector is the default", (await page.locator('select[name="hubId"]').count()) === 1);
check("collector form asks for no password", (await page.locator('input[name="password"]').count()) === 0);
check("hub list has real hubs", (await page.locator('select[name="hubId"] option').count()) > 1);
await page.screenshot({ path: `${SHOTS}/signup-02-collector.png`, fullPage: true });

await Promise.all([page.waitForURL(/role=operator/), page.click('.signup-switch a:has-text("Operator")')]);
await page.waitForLoadState("networkidle");
check("operator form asks for email and password", (await page.locator('input[name="email"]').count()) === 1 && (await page.locator('input[name="password"]').count()) === 1);
check("operator form has no hub", (await page.locator('select[name="hubId"]').count()) === 0);
await page.screenshot({ path: `${SHOTS}/signup-03-operator.png`, fullPage: true });

// Phone-sized: the panel stacks and nothing scrolls sideways.
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${DASH}/signup`, { waitUntil: "networkidle" });
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
check("no sideways scroll at 390px", overflow <= 0, `overflow ${overflow}px`);
const stacked = await page.evaluate(() => {
  const pitch = document.querySelector(".signup-pitch").getBoundingClientRect();
  const form = document.querySelector(".signup-form").getBoundingClientRect();
  return pitch.bottom <= form.top + 1;
});
check("welcome panel stacks above the form on a phone", stacked);
await page.screenshot({ path: `${SHOTS}/signup-04-phone.png`, fullPage: true });

await page.emulateMedia({ colorScheme: "dark" });
await page.setViewportSize({ width: 1400, height: 1000 });
await page.goto(`${DASH}/signup?role=operator`, { waitUntil: "networkidle" });
await page.screenshot({ path: `${SHOTS}/signup-05-dark.png`, fullPage: true });
await page.emulateMedia({ colorScheme: "light" });

// ------------------------------------------------------------ 3. signing up
console.log("\n[3] Signing up");
await submitCollector(collector);
text = await bodyText();
check("collector sees the thank-you", text.includes("Thanks, Amina"));
check("collector is told to wait for approval", text.includes("waiting for approval"));
await page.screenshot({ path: `${SHOTS}/signup-06-thanks.png`, fullPage: true });

await submitCollector({ name: "Somebody Else", phone: collector.phone });
text = await bodyText();
check(
  "same phone twice is refused in plain words",
  text.includes("A sign-up with this phone number is already waiting for approval."),
  (await page.locator(".error").allInnerTexts()).join(" | "),
);
check(
  "the form keeps what was typed",
  (await page.inputValue('input[name="name"]')) === "Somebody Else" &&
    (await page.inputValue('input[name="phone"]')) === collector.phone,
);
await page.screenshot({ path: `${SHOTS}/signup-07-duplicate.png`, fullPage: true });

await submitCollector(rejected);

await page.goto(`${DASH}/signup?role=operator`, { waitUntil: "networkidle" });
await page.fill('input[name="name"]', operator.name);
await page.fill('input[name="email"]', operator.email);
await page.fill('input[name="phone"]', operator.phone);
await page.fill('input[name="password"]', "short");
await page.click('main button[type="submit"]');
await page.waitForTimeout(500);
check("a short password is stopped before it is sent", /\/signup\?role=operator$/.test(page.url()));
await page.fill('input[name="password"]', operator.password);
await submitSignupForm();
check("operator sees the thank-you", (await bodyText()).includes("Thanks, Tunde"));

// ------------------------------------------------------------ 4. not yet
console.log("\n[4] Nothing works before approval");
await signIn(operator);
text = await bodyText();
check("unapproved operator cannot sign in", /\/login/.test(page.url()));
check("the sign-in page explains why", text.includes("may still be waiting for approval"));
await page.screenshot({ path: `${SHOTS}/signup-08-not-yet.png`, fullPage: true });

await page.goto(`${DASH}/signups`, { waitUntil: "networkidle" });
text = await bodyText();
check("the queue is closed to the signed-out", !text.includes(collector.name) && /not signed in/i.test(text));

await signIn(AUDITOR);
await page.goto(`${DASH}/signups`, { waitUntil: "networkidle" });
text = await bodyText();
check(
  "an auditor sees no sign-ups",
  !text.includes(collector.name) && text.includes("Sign-ups are reviewed by admins and operators."),
);
await signOut();

await signIn(STAFF_OPERATOR);
await page.goto(`${DASH}/signups`, { waitUntil: "networkidle" });
text = await bodyText();
check("a staff operator sees collector sign-ups", text.includes(collector.name));
check("a staff operator does not see operator sign-ups", !text.includes(operator.name));
await signOut();

// ------------------------------------------------------------ 5. approval
console.log("\n[5] An admin decides");
await signIn(ADMIN);
await page.goto(`${DASH}/collectors`, { waitUntil: "networkidle" });
check("pending collector is not on the roster", !(await bodyText()).includes(collector.name));

await page.goto(`${DASH}/signups`, { waitUntil: "networkidle" });
text = await bodyText();
check("admin sees the collector sign-up", text.includes(collector.name) && text.includes(collector.phone));
check("admin sees the operator sign-up", text.includes(operator.name) && text.includes(operator.email));
check("no password material on the page", !/argon2|passwordHash/i.test(await page.content()));
await page.screenshot({ path: `${SHOTS}/signup-09-queue.png`, fullPage: true });

const row = (name) => page.locator("tbody tr", { hasText: name });

// The URL is not a reliable signal here (two approvals in a row both end on
// `?approved=`), so each decision waits for its own row to leave the queue.
await row(operator.name).locator('button:has-text("Approve")').click();
await row(operator.name).waitFor({ state: "detached" });
check("approving an operator says they can sign in", (await bodyText()).includes("They can now sign in."));

await row(collector.name).locator('button:has-text("Approve")').click();
await row(collector.name).waitFor({ state: "detached" });
check("approving a collector points to the Collectors page", (await bodyText()).includes("Pair their phone from the Collectors page"));

await row(rejected.name).locator("summary").click();
await page.screenshot({ path: `${SHOTS}/signup-10-reject-confirm.png`, fullPage: true });
check("reject asks first", await row(rejected.name).locator('button:has-text("Yes, reject")').isVisible());
await row(rejected.name).locator('button:has-text("Yes, reject")').click();
await row(rejected.name).waitFor({ state: "detached" });
text = await bodyText();
check("rejection is confirmed", text.includes(`Rejected ${rejected.name}.`));
check(
  "decided sign-ups leave the queue",
  (await row(operator.name).count()) === 0 &&
    (await row(collector.name).count()) === 0 &&
    (await row(rejected.name).count()) === 0,
);

await page.goto(`${DASH}/collectors`, { waitUntil: "networkidle" });
text = await bodyText();
check("approved collector is on the roster", text.includes(collector.name));
check("rejected collector is not", !text.includes(rejected.name));
await page.screenshot({ path: `${SHOTS}/signup-11-roster.png`, fullPage: true });
await signOut();

// ------------------------------------------------------------ 6. in
console.log("\n[6] The approved operator signs in");
await signIn(operator);
check("approved operator reaches the dashboard", !/\/login/.test(page.url()), page.url());
check("and is signed in", (await bodyText()).includes("Sign out"));

await browser.close();

const failed = results.filter((r) => !r.ok);
if (consoleErrors.length) {
  console.log(`\nconsole errors (${consoleErrors.length}):`);
  for (const e of consoleErrors.slice(0, 10)) console.log(`  ${e}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
