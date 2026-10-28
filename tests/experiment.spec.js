// End-to-end test: a robot participant runs the whole experiment.
//
// Two modes:
//   - Emulator mode (EMULATOR=1, set automatically by `npm test`): data must land in the
//     local Firestore emulator, the security rules must reject forbidden requests, and
//     client errors must be logged.
//   - Offline mode (plain `npx playwright test`): the experiment must still run to the end
//     and offer the JSON download fallback.
//
// If you change the timeline in experiment.js, update `runThroughExperiment` below so the
// robot still knows which buttons to press. That is a feature: the test documents the flow.

const { test, expect, devices } = require("@playwright/test");

const EMULATOR = process.env.EMULATOR === "1" || !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = "demo-psych251";
const EXPERIMENT_ID = "pan2023-pilot-b";
const FS = `http://localhost:8080/v1/projects/${PROJECT}/databases/(default)/documents`;

// Every run uses ?speed=50: the 5 s study screens become 100 ms and each 5-minute Tetris
// becomes 6 s. The speed parameter only works on localhost, so it cannot affect the live site.
const SPEED = "speed=50";
function url(params = "") {
  const base = EMULATOR ? "/?emulator=1&" + SPEED : "/?" + SPEED;
  return params ? base + "&" + params : base;
}

async function clickNext(page) {
  await page.locator("#jspsych-instructions-next").click();
}
async function surveyContinue(page) {
  await page.locator('input[value="Continue"]').click();
}

// Plays one cycle. Recall answers: every second pair right, one pair with a typo (which the
// lenient scoring accepts), the rest left blank.
async function runCycle(page, cycle) {
  // Learning instructions (two pages); the study phase then runs by itself.
  await clickNext(page);
  await clickNext(page);
  // Type a guess into the first pretest box that appears (it lasts 100 ms at this speed,
  // so the robot may miss it; that is fine, a missed window is recorded as an empty guess).
  await page.locator("#guess").first().waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
  await page.keyboard.type("x").catch(() => {});

  // Two predictions (random order), 8 each.
  for (let i = 0; i < 2; i++) {
    const box = page.locator('input[type="number"]');
    await box.waitFor({ state: "visible", timeout: 60000 });
    // Both prediction screens use the same input, so wait for this screen's title to go.
    const which = await page.getByText(/^There were 16 (read|pretested) word pairs\.$/).textContent();
    await box.fill("8");
    await surveyContinue(page);
    await page.getByText(which, { exact: true }).waitFor({ state: "detached" });
  }

  // Tetris: instructions, then press some keys while the (shortened) game runs.
  await clickNext(page);
  await page.locator("#tetris-board").waitFor({ state: "visible" });
  for (const k of ["ArrowLeft", "ArrowUp", "ArrowRight", "Space", "ArrowDown"]) await page.keyboard.press(k);

  // Test: instructions, then 32 self-paced items.
  await page.getByRole("heading", { name: "Memory test" }).waitFor({ timeout: 60000 });
  await clickNext(page);
  const answers = await page.evaluate(() =>
    Object.fromEntries(Object.values(window.STIMULI).flat().map(([cue, target]) => [cue, target])));
  for (let i = 0; i < 32; i++) {
    const pair = page.locator(".pair[data-cue]");
    await pair.waitFor({ state: "visible" });
    const cue = await pair.getAttribute("data-cue");
    let answer = "";
    if (i === 1) answer = answers[cue].slice(0, -1);       // one typo: last letter missing
    else if (i % 2 === 0) answer = answers[cue].toUpperCase() + " ";
    await page.locator("#jspsych-survey-text-form input[type=text]").fill(answer);
    await page.keyboard.press("Enter");
    await page.locator(`.pair[data-cue="${cue}"]`).waitFor({ state: "detached" });
  }

  // Feedback: read the scores shown, so the attention checks can be answered correctly.
  await expect(page.getByText(`Your Round ${cycle} results`)).toBeVisible();
  const score = async (cls) => Number((await page.locator(cls).textContent()).split(" ")[0]);
  const scores = { read: await score(".read-score"), pretested: await score(".pretest-score") };
  await page.getByRole("button", { name: "Continue" }).click();

  if (cycle === 1) {
    for (let i = 0; i < 2; i++) {
      const q = page.locator(".question strong");
      await q.waitFor({ state: "visible" });
      const which = (await q.textContent()).trim();
      const actual = scores[which];
      const word = 8 > actual ? "higher" : 8 < actual ? "lower" : "the same";
      await page.getByRole("button", { name: `My prediction was ${word}` }).click();
      // The two check screens look alike, so wait for this one's condition word to go.
      await page.locator(".question strong", { hasText: new RegExp(`^${which}$`) }).waitFor({ state: "detached" });
    }
    await expect(page.getByText("once more")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
  } else {
    await page.getByText("Lucky guesses").click();
    await surveyContinue(page);
  }
  return scores;
}

async function runThroughExperiment(page, { finish = true } = {}) {
  await page.getByRole("button", { name: "I agree to participate" }).click();
  await clickNext(page);
  await clickNext(page);
  await page.locator('input[type="number"]').fill("34");
  await page.getByText("Woman", { exact: true }).click();
  await page.locator('[data-name="native_english"]').getByText("Yes", { exact: true }).first().click();
  await surveyContinue(page);

  await runCycle(page, 1);
  await page.getByRole("heading", { name: "Round 2" }).waitFor();
  await clickNext(page);
  await runCycle(page, 2);

  // Exit questions: one rating and the preference; the rest skipped (none are required).
  await page.locator('[data-name="read_effectiveness"]').getByText("6", { exact: true }).first().click();
  await page.getByText("Pretesting", { exact: true }).click();
  await surveyContinue(page);
  await page.locator('input[name="Q0"][value="4"]').check();
  await page.locator("#jspsych-survey-likert-next").click();
  await page.locator("textarea").fill("Robot participant says hi.");
  await page.locator("#jspsych-survey-text-next").click();
  if (!finish) return;
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByText("All done")).toBeVisible({ timeout: 30000 });
}

async function fsGet(path) {
  // "Bearer owner" is the emulator's admin token: it bypasses security rules, like the Admin SDK.
  const r = await fetch(`${FS}/${path}`, { headers: { Authorization: "Bearer owner" } });
  return { status: r.status, body: r.status === 200 ? await r.json() : null };
}

// List every document in a collection, following page tokens (the emulator pages long lists).
async function fsList(path) {
  const out = [];
  let token = "";
  do {
    const r = await fsGet(`${path}?pageSize=300${token ? "&pageToken=" + encodeURIComponent(token) : ""}`);
    expect(r.status).toBe(200);
    out.push(...(r.body.documents || []).map((d) => decodeFields(d.fields)));
    token = r.body.nextPageToken || "";
  } while (token);
  return out;
}

// Unwrap Firestore REST "fields" encoding into plain JS.
function decode(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
  return v;
}
function decodeFields(fields) {
  const out = {};
  for (const k of Object.keys(fields)) out[k] = decode(fields[k]);
  return out;
}

test.describe("experiment", () => {
  test("runs to the end and saves data", async ({ page }) => {
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));

    await page.goto(url(EMULATOR ? "chunk_size=1&PROLIFIC_PID=robot123&STUDY_ID=s1&SESSION_ID=sess1" : ""));
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    const mode = await page.evaluate(() => window.__saver.mode);
    expect(mode).toBe(EMULATOR ? "emulator" : "offline");

    await runThroughExperiment(page);

    // No uncaught errors from the experiment itself.
    expect(consoleErrors, "uncaught page errors").toEqual([]);

    const uid = await page.evaluate(() => window.__saver.docId);
    const stats = await page.evaluate(() => window.__saver.stats);

    if (!EMULATOR) {
      // Offline: banner + download fallback, nothing else to check.
      await expect(page.locator("#data-saver-banner")).toHaveAttribute("data-kind", "offline");
      await expect(page.locator("#data-saver-fallback")).toBeVisible();
      return;
    }

    expect(stats.writes_failed).toBe(0);
    await expect(page.locator("#data-saver-fallback")).toHaveCount(0);

    // Participant document is complete and carries the list order + Prolific ids.
    const p = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}`);
    expect(p.status).toBe(200);
    const pdoc = decodeFields(p.body.fields);
    expect(pdoc.completed).toBe(true);
    expect(pdoc.design).toBe("within-subjects");
    expect([...pdoc.list_order].sort().join("")).toBe("abcd");
    expect(pdoc.prolific_pid).toBe("robot123");
    expect(pdoc.n_trials).toBeGreaterThan(150);
    expect(typeof pdoc.full_data).toBe("string");
    const full = JSON.parse(pdoc.full_data);
    expect(full.length).toBe(pdoc.n_trials);

    // One chunk per trial (chunk_size = 1 in this test), each carrying the trial data.
    const docs = await fsList(`experiments/${EXPERIMENT_ID}/participants/${uid}/trials`);
    expect(docs.length).toBe(pdoc.n_trials);
    const trials = docs.flatMap((d) => d.trials);
    const demo = trials.find((t) => t.task === "demographics");
    expect(demo.response.age).toBe(34);

    for (const cycle of [1, 2]) {
      const inCycle = (task) => trials.filter((t) => t.task === task && t.cycle === cycle);
      // Study phase: 16 read + 16 pretest guesses, each pretested pair also shown intact.
      const study = inCycle("study");
      expect(study.filter((t) => t.condition === "read").length).toBe(16);
      expect(study.filter((t) => t.phase_step === "pretest_answer").length).toBe(16);
      const guesses = inCycle("pretest_guess");
      expect(guesses.length).toBe(16);
      expect(guesses.every((t) => typeof t.guess === "string" && typeof t.guess_correct === "boolean")).toBe(true);
      // Read and pretested lists differ and come from the participant's list order.
      const readList = study.find((t) => t.condition === "read").list;
      expect(guesses[0].list).not.toBe(readList);
      expect(pdoc.list_order[(cycle - 1) * 2]).toBe(readList);
      // Predictions: one per condition, both 8, in some order.
      const preds = inCycle("prediction");
      expect(preds.map((t) => t.condition).sort()).toEqual(["pretest", "read"]);
      expect(preds.every((t) => t.prediction === 8)).toBe(true);
      // Distractor ran and logged the game.
      const tetris = inCycle("distractor");
      expect(tetris.length).toBe(1);
      expect(tetris[0].tetris_keypresses).toBeGreaterThan(0);
      // Test: all 32 pairs, 16 per condition; robot got every other pair right plus one typo.
      const test = inCycle("test");
      expect(test.length).toBe(32);
      expect(test.filter((t) => t.condition === "read").length).toBe(16);
      expect(test.filter((t) => t.correct).length).toBe(17);
      expect(test.filter((t) => t.correct_strict).length).toBe(16);
      expect(test.filter((t) => t.condition === "pretest").every((t) => typeof t.guess_correct === "boolean")).toBe(true);
      expect(test.filter((t) => t.condition === "read").every((t) => t.guess_correct === null)).toBe(true);
      // Feedback matches the test rows.
      const fb = inCycle("feedback_display");
      expect(fb.length).toBe(cycle === 1 ? 2 : 1);
      expect(fb[0].read_correct).toBe(test.filter((t) => t.condition === "read" && t.correct).length);
      expect(fb[0].pretest_correct).toBe(test.filter((t) => t.condition === "pretest" && t.correct).length);
      expect(fb[0].with_predictions).toBe(cycle === 1);
    }
    // Attention checks (Cycle 1): both answered correctly by the robot.
    const checks = trials.filter((t) => t.task === "attention_check");
    expect(checks.length).toBe(2);
    expect(checks.every((t) => t.passed === true)).toBe(true);
    expect(trials.find((t) => t.task === "attribution").attribution).toBe("lucky_guesses");
    const exit = trials.find((t) => t.task === "exit_questions");
    expect(exit.response.preference).toBe("pretest");

    // Every trial row must carry the same participant id as its participant document,
    // otherwise trials.csv and participants.csv cannot be joined in the analysis.
    expect([...new Set(trials.map((t) => t.participant_id))]).toEqual([uid]);
  });

  test("chunked writes (chunk_size > 1) save every trial", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    await page.goto(url("chunk_size=5"));
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    await runThroughExperiment(page);
    const uid = await page.evaluate(() => window.__saver.docId);
    const p = decodeFields((await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}`)).body.fields);
    const docs = await fsList(`experiments/${EXPERIMENT_ID}/participants/${uid}/trials`);
    expect(docs.length).toBe(Math.ceil(p.n_trials / 5));
    const indices = docs.flatMap((d) => d.trials).map((t) => t.trial_index).sort((a, b) => a - b);
    expect(indices).toEqual([...Array(p.n_trials).keys()]);
  });

  test("declining consent ends the study without a thank-you-for-your-data message", async ({ page }) => {
    await page.goto(url());
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    await page.getByRole("button", { name: "I do not agree" }).click();
    await expect(page.getByText("You chose not to participate")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Your responses were saved")).toHaveCount(0);
  });

  test("losing the connection at the end offers the download fallback instead of hanging", async ({ page, context }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    test.setTimeout(180000);
    // Run the real flow up to the last click, then cut the connection before "Finish".
    await page.goto(url());
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    await runThroughExperiment(page, { finish: false });
    await context.setOffline(true);
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.locator("#data-saver-fallback")).toBeVisible({ timeout: 40000 });
    await expect(page.getByText("connection to the server was lost")).toBeVisible();
    await expect(page.getByText("Your responses were saved")).toHaveCount(0);
    await context.setOffline(false);
  });

  test("a second run in the same browser is a new participant and saves cleanly", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    test.setTimeout(240000);

    const ids = [];
    for (let run = 0; run < 2; run++) {
      // Same page/context both times: the anonymous auth session persists, exactly as it
      // does for a student testing twice in one browser or a participant who reloads.
      await page.goto(url("PROLIFIC_PID=rerun" + run));
      await page.waitForFunction(() => window.__saver && window.__saver.docId);
      await runThroughExperiment(page);
      const info = await page.evaluate(() => ({
        uid: window.__saver.uid, docId: window.__saver.docId, stats: window.__saver.stats,
      }));
      expect(info.stats.writes_failed, "run " + run + " had failed writes").toBe(0);
      await expect(page.locator("#data-saver-fallback")).toHaveCount(0);
      ids.push(info);
    }

    expect(ids[0].uid).toBe(ids[1].uid);          // same browser, same anonymous identity
    expect(ids[0].docId).not.toBe(ids[1].docId);  // but a separate participant record

    // Both runs survive intact, with their own Prolific id and their own trials.
    for (let run = 0; run < 2; run++) {
      const p = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${ids[run].docId}`);
      expect(p.status).toBe(200);
      const pdoc = decodeFields(p.body.fields);
      expect(pdoc.completed, "run " + run + " completed").toBe(true);
      expect(pdoc.prolific_pid).toBe("rerun" + run);
      const chunks = await fsList(`experiments/${EXPERIMENT_ID}/participants/${ids[run].docId}/trials`);
      expect(chunks.length).toBe(Math.ceil(pdoc.n_trials / 10));
    }
  });

  test("setting a Prolific completion code does not break the test run", async ({ page }) => {
    // Regression test for the failure students hit right before launch: with a completion
    // code set, the live page redirects to Prolific, but a test run must stay put so that
    // `npm test` and CI keep passing.
    const navigations = [];
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) navigations.push(f.url()); });

    await page.goto(url("cc=QA123CODE"));
    await page.waitForFunction(() => window.__saver && window.__saver.docId);
    await runThroughExperiment(page);

    expect(navigations.some((u) => u.includes("prolific.com")), "must not navigate to Prolific").toBe(false);
    if (EMULATOR) await expect(page.getByText("QA123CODE")).toBeVisible();
  });

  test("phones and tablets are turned away before consent", async ({ browser }) => {
    const context = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await context.newPage();
    await page.goto("http://localhost:8017/?emulator=1");
    await expect(page.locator("#device-unsupported")).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("button", { name: "I agree to participate" })).toHaveCount(0);

    if (EMULATOR) {
      // The turned-away visit is still recorded, so phone traffic is visible in the data.
      await page.waitForFunction(() => window.__saver && window.__saver.docId);
      const docId = await page.evaluate(() => window.__saver.docId);
      await page.evaluate(() => window.__saver._settle());
      const p = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${docId}`);
      const pdoc = decodeFields(p.body.fields);
      expect(pdoc.device_supported).toBe(false);
      expect(pdoc.completed).toBe(false);
    }
    await context.close();
  });

  test("a desktop browser is not turned away", async ({ page }) => {
    await page.goto(url());
    await expect(page.getByRole("button", { name: "I agree to participate" })).toBeVisible();
    await expect(page.locator("#device-unsupported")).toHaveCount(0);
  });

  test("a write the database refuses is announced on the page, not only in the console", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    // Regression test for the state a student is in when they skip publishing the rules, or
    // once test-mode rules expire: sign-in succeeds, so the page used to look perfectly
    // healthy from consent to debrief and only admitted the problem on the last screen.
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.docId);
    // Emulator runs carry an informational banner; what must be absent is a failure banner.
    await expect(page.locator('#data-saver-banner[data-kind="offline"]')).toHaveCount(0);

    // Force a genuine permission-denied on a normal save path by aiming the participant
    // document at someone else's id, which the rules refuse exactly as deny-all rules would.
    await page.evaluate(async () => {
      window.__saver.docId = "someone-else-deadbeef";
      await window.__saver.updateParticipant({ blocked: true });
    });

    const banner = page.locator("#data-saver-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-kind", "offline");
    await expect(banner).toContainText("NOT being saved");
    await expect(banner).toContainText("permission-denied");
    await expect(banner).toContainText("2.3");
    expect(await page.evaluate(() => window.__saver.stats.writes_failed)).toBeGreaterThan(0);
  });

  test("the download fallback tells the participant where to send the file", async ({ page }) => {
    await page.goto(url());
    await page.waitForFunction(() => window.__saver && window.__saver.docId);
    await page.evaluate(() => window.__saver._offerDownload(null, "[]"));
    const box = page.locator("#data-saver-fallback");
    await expect(box).toBeVisible();
    await expect(box).toContainText("@");                       // a contact address is present
    await expect(box).toContainText("you will be paid");
    await expect(box.getByRole("link")).toHaveAttribute("href", /^mailto:/);
  });

  test("security rules reject reads and writes to other participants", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);

    const results = await page.evaluate(async () => {
      const s = window.__saver;
      const fb = s.fb;
      const out = {};
      const attempt = async (name, fn) => {
        try { await fn(); out[name] = "allowed"; } catch (e) { out[name] = e.code || e.message; }
      };
      await attempt("read own doc", () =>
        fb.getDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", s.docId)));
      await attempt("write other participant", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", "someone-else"), { hacked: true }));
      await attempt("write other participant trials", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", "someone-else", "trials", "c0"), { trials: [] }));
      await attempt("write unrelated collection", () =>
        fb.setDoc(fb.doc(s.db, "spam", "doc"), { spam: true }));
      await attempt("error doc with wrong uid", () =>
        fb.addDoc(fb.collection(s.db, "experiments", s.opts.experiment_id, "errors"), { uid: "not-me", message: "x" }));
      await attempt("own chunk (should be allowed)", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", s.docId, "trials", "chunk-test"), { trials: [{ a: 1 }] }));
      await attempt("participant doc without the run suffix", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", s.uid), { sneaky: true }));
      await attempt("another browser's run id", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", "someone-else-abcd1234"), { sneaky: true }));
      return out;
    });

    expect(results["read own doc"]).toBe("permission-denied");
    expect(results["write other participant"]).toBe("permission-denied");
    expect(results["write other participant trials"]).toBe("permission-denied");
    expect(results["write unrelated collection"]).toBe("permission-denied");
    expect(results["error doc with wrong uid"]).toBe("permission-denied");
    expect(results["own chunk (should be allowed)"]).toBe("allowed");
    expect(results["participant doc without the run suffix"]).toBe("permission-denied");
    expect(results["another browser's run id"]).toBe("permission-denied");
  });

  test("uncaught errors are logged to the errors collection", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    const uid = await page.evaluate(() => window.__saver.uid);

    // Simulate a bug in a trial: an uncaught exception.
    await page.evaluate(() => {
      setTimeout(() => { throw new Error("simulated bug in trial code"); }, 0);
    });
    await page.waitForFunction(() => window.__saver.stats.errors_logged >= 1);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));

    const errs = await fsGet(`experiments/${EXPERIMENT_ID}/errors?pageSize=100`);
    const mine = (errs.body.documents || []).map((d) => decodeFields(d.fields)).filter((d) => d.uid === uid);
    expect(mine.length).toBe(1);
    expect(mine[0].message).toContain("simulated bug");
    expect(mine[0].context.kind).toBe("uncaught");
  });
});
