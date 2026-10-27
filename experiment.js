/*
 * Replication of Pan & Rivers (2023), Memory & Cognition 51:1461-1480, Experiment 3:
 * "Metacognitive awareness of the pretesting effect improves with self-regulation support."
 *
 * Design summary (keep this current):
 *   IVs:      practice condition (read vs pretest) x cycle (1 vs 2), both within-subjects.
 *   DVs:      global-differentiated predictions, 0-16 (task "prediction", field `prediction`);
 *             criterial-test recall (task "test", fields `correct` / `correct_strict`).
 *   Trials:   per cycle, 32 pairs (16 read + 16 pretested, randomly intermixed). Read = intact
 *             pair 5 s. Pretest = cue + text box 5 s, then intact pair 5 s. Two predictions
 *             (random order), 5-min Tetris, self-paced cued-recall test of all 32 (random order,
 *             no feedback), then performance feedback. Cycle 1 feedback also shows the
 *             participant's own predictions (the Exp 3 manipulation), followed by two
 *             prediction-vs-performance questions and a second look at the feedback.
 *             Cycle 2 uses new pairs and ends with feedback and an attribution question.
 *   Random:   the four 16-pair lists are shuffled per participant: lists 1-2 go to Cycle 1,
 *             3-4 to Cycle 2; the first of each pair is read, the second pretested.
 *             Item order within each phase and the order of the two predictions are random.
 *   Checks:   the two Cycle 1 prediction-vs-performance questions are the original's
 *             attention checks (field `passed`); nobody is ejected, exclusion happens in the
 *             analysis. Pretested items guessed correctly at pretest are dropped from recall
 *             scoring in the analysis (field `guess_correct` on test rows).
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
window.TEMPLATE_VERSION = "0.1.0";

const EXPERIMENT = {
  // Firestore path: experiments/<id>/participants/... Change it for each phase so pilot
  // data and real data never mix: pan2023-pilot-a -> pan2023-pilot-b -> pan2023-final.
  id: "pan2023-pilot-b",

  // ~185 trials per participant, so write every 10 trials (~22 writes per participant).
  chunk_size: 10,

  save_full_data_at_end: true,

  // Prolific: set this to the completion code from your Prolific study before Pilot B.
  prolific_completion_code: "C9738RQA",

  contact_email: "stanfordpsych251@gmail.com",

  // Keyboard needed: typing answers and playing Tetris.
  requires_keyboard: true,

  // Timing from the original (milliseconds).
  study_ms: 5000,          // read trial; pretest guess window; pretest answer display
  distractor_ms: 300000,   // 5-minute Tetris
};

function hasFinePointer() {
  return !!(window.matchMedia && window.matchMedia("(any-pointer: fine)").matches);
}

const URL_PARAMS = new URLSearchParams(window.location.search);
const USE_EMULATOR = URL_PARAMS.get("emulator") === "1";
const CHUNK_SIZE = Number(URL_PARAMS.get("chunk_size")) || EXPERIMENT.chunk_size;
if (USE_EMULATOR && URL_PARAMS.get("cc")) EXPERIMENT.prolific_completion_code = URL_PARAMS.get("cc");

// Test/development only: `?speed=N` divides every timed duration by N so the robot (and you,
// when checking the flow) do not wait 30 minutes. Ignored anywhere except localhost, so it can
// never change timing on GitHub Pages.
const IS_LOCAL = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const SPEED = IS_LOCAL ? Math.max(1, Number(URL_PARAMS.get("speed")) || 1) : 1;
const STUDY_MS = Math.round(EXPERIMENT.study_ms / SPEED);
const DISTRACTOR_MS = Math.round(EXPERIMENT.distractor_ms / SPEED);

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------
function normalize(s) {
  return String(s || "").toLowerCase().replace(/[^a-z]/g, "");
}
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}
// Strict: identical after lower-casing and removing spaces/punctuation.
function scoreStrict(response, target) {
  return normalize(response) === normalize(target);
}
// Lenient (primary): additionally allows one typo (one letter added, dropped or changed).
function scoreLenient(response, target) {
  const r = normalize(response);
  return r.length > 0 && editDistance(r, normalize(target)) <= 1;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function main() {
  const deviceSupported = !EXPERIMENT.requires_keyboard || hasFinePointer();

  const saver = await DataSaver.init({
    experiment_id: EXPERIMENT.id,
    chunk_size: CHUNK_SIZE,
    save_full_data_at_end: EXPERIMENT.save_full_data_at_end,
    use_emulator: USE_EMULATOR,
    contact_email: EXPERIMENT.contact_email,
  });
  window.__saver = saver;

  saver.updateParticipant({ device_supported: deviceSupported, requires_keyboard: EXPERIMENT.requires_keyboard });

  if (!deviceSupported) {
    document.body.innerHTML =
      '<div id="device-unsupported" class="jspsych-content" style="max-width:640px;margin:15vh auto;font:16px/1.6 system-ui,sans-serif;">' +
      "<h2>Please use a computer</h2>" +
      "<p>This study needs a computer with a physical keyboard, because you will type answers and " +
      "play a short keyboard game. Phones and tablets cannot be used.</p>" +
      "<p>Please reopen this link on a laptop or desktop computer. If you were sent here from " +
      "Prolific, you can return the study and take it later on a computer; nothing has been recorded " +
      "against you.</p>" +
      "<p>Questions: <a href=\"mailto:" + EXPERIMENT.contact_email + "\">" + EXPERIMENT.contact_email + "</a></p></div>";
    return;
  }

  const jsPsych = initJsPsych({
    show_progress_bar: true,
    auto_update_progress_bar: true,
    on_data_update: (trial) => saver.onTrial(trial),
    on_finish: async () => {
      const el = jsPsych.getDisplayElement();
      el.innerHTML = '<div id="finish-message"><p class="thanks">Saving your responses…</p></div>';
      const result = await saver.finish(jsPsych);
      const consentRow = jsPsych.data.get().filter({ task: "consent" }).values()[0];
      const consented = !consentRow || consentRow.consented !== false;
      const msg = document.getElementById("finish-message");

      if (!consented) {
        msg.innerHTML = "<h2 class='thanks'>Thank you</h2><p class='thanks'>You chose not to participate. " +
          "You may close this window" + (EXPERIMENT.prolific_completion_code ? " and return the study on Prolific" : "") + ".</p>";
        return;
      }
      if (result.ok && EXPERIMENT.prolific_completion_code && !USE_EMULATOR) {
        msg.innerHTML = "<p class='thanks'>Saved. Returning you to Prolific…</p>";
        window.location.href =
          "https://app.prolific.com/submissions/complete?cc=" + EXPERIMENT.prolific_completion_code;
        return;
      }
      msg.innerHTML =
        "<h2 class='thanks'>All done</h2>" +
        (result.ok ? "<p class='thanks'>Your responses were saved. Thank you for participating!</p>" : "") +
        (EXPERIMENT.prolific_completion_code
          ? "<p class='thanks'>Your completion code is <strong>" + EXPERIMENT.prolific_completion_code + "</strong>.</p>"
          : "");
    },
  });

  // -------------------------------------------------------------------------
  // List assignment (within-subjects; counterbalanced by random list order)
  // -------------------------------------------------------------------------
  const listOrder = jsPsych.randomization.shuffle(["a", "b", "c", "d"]);
  const cycles = [
    { cycle: 1, read: listOrder[0], pretest: listOrder[1] },
    { cycle: 2, read: listOrder[2], pretest: listOrder[3] },
  ];

  jsPsych.data.addProperties({
    participant_id: saver.docId,
    prolific_pid: saver.params.PROLIFIC_PID || null,
    experiment_id: EXPERIMENT.id,
    list_order: listOrder.join(""),
  });
  saver.updateParticipant({ design: "within-subjects", list_order: listOrder.join(""), speed: SPEED });

  // Everything the feedback screens need, filled in as the participant goes.
  const results = { 1: {}, 2: {} };

  // -------------------------------------------------------------------------
  // Consent (course-wide IRB text; edit only the contact address)
  // -------------------------------------------------------------------------
  const consent = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <div class="consent">
        <h2>Consent</h2>
        <p>By answering the following questions, you are participating in a study being performed by
        cognitive scientists in the Stanford Department of Psychology. If you have questions about
        this research, please contact us at <a href="mailto:${EXPERIMENT.contact_email}">${EXPERIMENT.contact_email}</a>.
        You must be at least 18 years old to participate. Your participation in this research is
        voluntary. You may decline to answer any or all of the following questions. You may decline
        further participation, at any time, without adverse consequences. Your anonymity is assured;
        the researchers who have requested your participation will not receive any personal
        information about you.</p>
      </div>`,
    choices: ["I agree to participate", "I do not agree"],
    data: { task: "consent" },
    on_finish: (data) => {
      data.consented = data.response === 0;
      if (!data.consented) jsPsych.abortExperiment();
    },
  };

  const welcome = {
    type: jsPsychInstructions,
    pages: [
      `<h2>Welcome</h2>
       <p>In this study you will learn pairs of words and then be tested on them. There are two
       rounds. Each round has a learning phase, a few questions, a five-minute game of Tetris,
       and a memory test. The whole study takes about 35 minutes.</p>`,
      `<p>Please complete the study in one sitting, in a quiet place, on a laptop or desktop
       computer, and keep this window open and in focus the whole time.</p>
       <p><strong>Please do not write anything down or use notes.</strong> We are interested in
       what you can remember on your own. Your payment does not depend on your score.</p>`,
    ],
    show_clickable_nav: true,
    data: { task: "instructions" },
  };

  const demographics = {
    type: jsPsychSurvey,
    survey_json: {
      showQuestionNumbers: "off",
      completeText: "Continue",
      pages: [{
        elements: [
          { type: "text", name: "age", title: "How old are you?", inputType: "number", min: 18, max: 120 },
          {
            type: "radiogroup", name: "gender", title: "What is your gender?",
            choices: ["Woman", "Man", "Non-binary"], showOtherItem: true, showNoneItem: true, noneText: "Prefer not to say",
          },
          { type: "boolean", name: "native_english", title: "Is English your first language?", labelTrue: "Yes", labelFalse: "No" },
        ],
      }],
    },
    data: { task: "demographics" },
  };

  // -------------------------------------------------------------------------
  // Building blocks for one cycle
  // -------------------------------------------------------------------------
  function pairHtml(cue, target) {
    return `<div class="pair"><span class="cue">${cue}</span><span class="dash">–</span><span class="target">${target}</span></div>`;
  }

  function studyInstructions(c) {
    const first = c.cycle === 1;
    return {
      type: jsPsychInstructions,
      pages: [
        `<h2>${first ? "Round 1" : "Round 2"}: learning phase</h2>
         <p>${first ? "You will now see 32 pairs of words." : "You will now see 32 <strong>new</strong> pairs of words."}
         Your goal is to learn them so that later, when shown the first word, you can recall the second.</p>
         <p>The pairs will be presented in two ways, mixed together in random order:</p>
         <p><strong>Read:</strong> both words are shown for 5 seconds. Please read so that you
         remember the word pair well.</p>
         <p><strong>Pretest:</strong> you will be shown the first word and a text box. You will have
         5 seconds to type the missing word into the box. Please think of what the missing word
         might be, and type your answer as quickly as possible. Then the full pair is shown for
         5 seconds.</p>`,
        `<p>The screens move on by themselves. Keep your hands on the keyboard.</p>
         <p>Press <strong>Next</strong> to start.</p>`,
      ],
      show_clickable_nav: true,
      data: { task: "instructions", cycle: c.cycle },
    };
  }

  function studyPhase(c) {
    const items = jsPsych.randomization.shuffle([
      ...STIMULI[c.read].map(([cue, target], i) => ({ cue, target, item: i, list: c.read, condition: "read" })),
      ...STIMULI[c.pretest].map(([cue, target], i) => ({ cue, target, item: i, list: c.pretest, condition: "pretest" })),
    ]);
    let currentGuess = "";

    // The sequence is built explicitly (one read trial, or a guess + answer pair, per item)
    // rather than with conditional sub-timelines, so trial_index stays contiguous.
    const trials = items.flatMap((it) => {
      const base = { cycle: c.cycle, cue: it.cue, target: it.target, list: it.list, item: it.item, condition: it.condition };
      if (it.condition === "read") {
        return [{
          type: jsPsychHtmlKeyboardResponse,
          stimulus: `<p class="phase-label">Read</p>` + pairHtml(it.cue, it.target),
          choices: "NO_KEYS",
          trial_duration: STUDY_MS,
          data: { task: "study", phase_step: "read", ...base },
        }];
      }
      return [
        {
          type: jsPsychHtmlKeyboardResponse,
          stimulus: `<p class="phase-label">Pretest: type the missing word</p>
            <div class="pair" data-cue="${it.cue}">
              <span class="cue">${it.cue}</span><span class="dash">–</span>
              <input id="guess" class="answer" type="text" autocomplete="off" autocorrect="off"
                autocapitalize="off" spellcheck="false" aria-label="Your guess">
            </div>`,
          choices: "NO_KEYS",
          trial_duration: STUDY_MS,
          on_load: () => {
            currentGuess = "";
            const input = document.getElementById("guess");
            input.focus();
            input.addEventListener("input", () => { currentGuess = input.value; });
            input.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
          },
          data: { task: "pretest_guess", ...base },
          on_finish: (data) => {
            data.guess = currentGuess;
            data.guess_empty = normalize(currentGuess) === "";
            data.guess_correct = scoreLenient(currentGuess, data.target);
            data.guess_correct_strict = scoreStrict(currentGuess, data.target);
          },
        },
        {
          type: jsPsychHtmlKeyboardResponse,
          stimulus: `<p class="phase-label">Pretest: the correct pair</p>` + pairHtml(it.cue, it.target),
          choices: "NO_KEYS",
          trial_duration: STUDY_MS,
          data: { task: "study", phase_step: "pretest_answer", ...base },
        },
      ];
    });
    return { timeline: trials };
  }

  function predictionTrial(c, condition) {
    const label = condition === "read" ? "read" : "pretested";
    return {
      type: jsPsychSurvey,
      survey_json: {
        showQuestionNumbers: "off",
        completeText: "Continue",
        pages: [{
          elements: [{
            type: "text", name: "prediction", inputType: "number", min: 0, max: 16, step: 1,
            title: `There were 16 ${label} word pairs.`,
            description: `If you were to be tested (shown the first word and have to recall the second) on
              those 16 ${label} word pairs approximately 5 minutes from now, how many do you think you
              would answer correctly? Enter a whole number from 0 to 16.`.replace(/\s+/g, " "),
            validators: [{ type: "numeric", minValue: 0, maxValue: 16, text: "Please enter a number from 0 to 16." }],
          }],
        }],
      },
      data: { task: "prediction", cycle: c.cycle, condition },
      on_finish: (data) => {
        const v = data.response && data.response.prediction;
        data.prediction = v === undefined || v === null || v === "" ? null : Math.round(Number(v));
        results[c.cycle][condition + "_prediction"] = data.prediction;
      },
    };
  }

  function predictions(c) {
    const order = jsPsych.randomization.shuffle(["read", "pretest"]);
    return {
      timeline: order.map((cond, i) => {
        const t = predictionTrial(c, cond);
        t.data.prediction_order = i + 1;
        return t;
      }),
    };
  }

  function distractor(c) {
    const instr = {
      type: jsPsychInstructions,
      pages: [
        `<h2>Tetris</h2>
         <p>Now please play Tetris for five minutes. The game ends by itself.</p>
         <p><strong>←</strong> / <strong>→</strong> move the piece, <strong>↑</strong> rotates it,
         <strong>↓</strong> moves it down faster, and <strong>space</strong> drops it.
         Try to complete as many lines as you can. If the blocks reach the top, a new game starts.</p>`,
      ],
      show_clickable_nav: true,
      data: { task: "instructions", cycle: c.cycle },
    };
    let game = null, timer = null;
    const play = {
      type: jsPsychHtmlKeyboardResponse,
      stimulus: `<div class="tetris">
          <canvas id="tetris-board" width="260" height="520"></canvas>
          <div class="tetris-side">
            <p>Time left</p><p id="tetris-clock" class="tetris-big">5:00</p>
            <p>Lines</p><p id="tetris-lines" class="tetris-big">0</p>
          </div>
        </div>`,
      choices: "NO_KEYS",
      trial_duration: DISTRACTOR_MS,
      on_load: () => {
        const endAt = performance.now() + DISTRACTOR_MS;
        const clock = document.getElementById("tetris-clock");
        const lines = document.getElementById("tetris-lines");
        game = Tetris.start(document.getElementById("tetris-board"), {
          onTick: (s) => { lines.textContent = s.lines; },
        });
        const tick = () => {
          const left = Math.max(0, Math.ceil((endAt - performance.now()) / 1000));
          clock.textContent = Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
        };
        tick();
        timer = setInterval(tick, 250);
      },
      data: { task: "distractor", cycle: c.cycle, duration_ms: DISTRACTOR_MS },
      on_finish: (data) => {
        clearInterval(timer);
        const s = game ? game.stop() : {};
        Object.assign(data, {
          tetris_lines: s.lines, tetris_pieces: s.pieces, tetris_games: s.games,
          tetris_score: s.score, tetris_keypresses: s.keypresses,
        });
      },
    };
    return { timeline: [instr, play] };
  }

  function testPhase(c) {
    const items = [
      ...STIMULI[c.read].map(([cue, target], i) => ({ cue, target, item: i, list: c.read, condition: "read" })),
      ...STIMULI[c.pretest].map(([cue, target], i) => ({ cue, target, item: i, list: c.pretest, condition: "pretest" })),
    ];
    const instr = {
      type: jsPsychInstructions,
      pages: [
        `<h2>Memory test</h2>
         <p>You will now be tested on all 32 word pairs from this round, one at a time, in random order.</p>
         <p>For each one you will see the first word. Type the second word and press <strong>Enter</strong>
         (or click Continue). Take as long as you need. If you cannot remember, make your best guess or
         leave it blank.</p>`,
      ],
      show_clickable_nav: true,
      data: { task: "instructions", cycle: c.cycle },
    };
    const trial = {
      type: jsPsychSurveyText,
      preamble: () => `<p class="phase-label">Memory test</p>
        <div class="pair" data-cue="${jsPsych.evaluateTimelineVariable("cue")}">
          <span class="cue">${jsPsych.evaluateTimelineVariable("cue")}</span><span class="dash">–</span><span class="target">?</span>
        </div>`,
      questions: [{ prompt: "", name: "answer", required: false, placeholder: "type the second word" }],
      button_label: "Continue",
      data: {
        task: "test", cycle: c.cycle,
        cue: jsPsych.timelineVariable("cue"), target: jsPsych.timelineVariable("target"),
        list: jsPsych.timelineVariable("list"), item: jsPsych.timelineVariable("item"),
        condition: jsPsych.timelineVariable("condition"),
      },
      on_finish: (data) => {
        data.answer = (data.response && data.response.answer) || "";
        data.correct = scoreLenient(data.answer, data.target);
        data.correct_strict = scoreStrict(data.answer, data.target);
        // For pretested pairs, whether the pretest guess was already right: the original
        // analysis drops these items from recall scoring (Huelser & Metcalfe, 2012).
        if (data.condition === "pretest") {
          const g = jsPsych.data.get().filter({ task: "pretest_guess", cycle: c.cycle, cue: data.cue }).values()[0];
          data.guess_correct = g ? g.guess_correct : null;
        } else {
          data.guess_correct = null;
        }
      },
    };
    const tally = {
      // Not shown: computes this cycle's scores for the feedback screens.
      type: jsPsychHtmlKeyboardResponse, stimulus: "", choices: "NO_KEYS", trial_duration: 0,
      data: { task: "score_summary", cycle: c.cycle },
      on_finish: (data) => {
        const rows = jsPsych.data.get().filter({ task: "test", cycle: c.cycle }).values();
        data.read_correct = rows.filter((r) => r.condition === "read" && r.correct).length;
        data.pretest_correct = rows.filter((r) => r.condition === "pretest" && r.correct).length;
        results[c.cycle].read_correct = data.read_correct;
        results[c.cycle].pretest_correct = data.pretest_correct;
        data.read_prediction = results[c.cycle].read_prediction ?? null;
        data.pretest_prediction = results[c.cycle].pretest_prediction ?? null;
      },
    };
    return {
      timeline: [instr, { timeline: [trial], timeline_variables: items, randomize_order: true }, tally],
    };
  }

  function fmt(v) { return v === null || v === undefined ? "–" : v; }

  // withPredictions: Exp 3's Cycle 1 feedback shows the participant's own predictions beside
  // their scores. Cycle 2 feedback (as in Exp 2) shows scores only.
  function feedbackScreen(c, { withPredictions, viewing }) {
    return {
      type: jsPsychHtmlButtonResponse,
      stimulus: () => {
        const r = results[c.cycle];
        const head = viewing === 2
          ? `<h2>Your Round ${c.cycle} results, once more</h2><p>Please look over your results again before Round 2 begins.</p>`
          : `<h2>Your Round ${c.cycle} results</h2>`;
        const predRow = withPredictions
          ? `<tr><th>Your prediction</th><td>${fmt(r.read_prediction)} out of 16</td><td>${fmt(r.pretest_prediction)} out of 16</td></tr>`
          : "";
        const note = withPredictions
          ? `<p>Please check how closely your predictions matched your actual performance.</p>`
          : "";
        return `${head}
          <table class="feedback-table">
            <thead><tr><th></th><th>Read pairs</th><th>Pretested pairs</th></tr></thead>
            <tbody>
              <tr><th>Correctly recalled</th><td class="read-score">${r.read_correct} out of 16</td>
                  <td class="pretest-score">${r.pretest_correct} out of 16</td></tr>
              ${predRow}
            </tbody>
          </table>${note}`;
      },
      choices: ["Continue"],
      data: { task: "feedback_display", cycle: c.cycle, with_predictions: withPredictions, viewing },
      on_finish: (data) => {
        const r = results[c.cycle];
        Object.assign(data, {
          read_correct: r.read_correct, pretest_correct: r.pretest_correct,
          read_prediction: r.read_prediction ?? null, pretest_prediction: r.pretest_prediction ?? null,
        });
      },
    };
  }

  // The original's attention checks: contrast your prediction with your performance.
  const CHECK_OPTIONS = [
    "My prediction was higher than how well I actually performed.",
    "My prediction was lower than how well I actually performed.",
    "My prediction was the same as how well I actually performed.",
  ];
  const CHECK_KEYS = ["higher", "lower", "same"];
  function predictionCheck(c, condition) {
    const label = condition === "read" ? "read" : "pretested";
    return {
      type: jsPsychHtmlButtonResponse,
      stimulus: `<p class="question">For the <strong>${label}</strong> word pairs, which statement is true?</p>`,
      choices: CHECK_OPTIONS,
      button_layout: "flex",
      button_html: (choice) => `<button class="jspsych-btn check-btn">${choice}</button>`,
      data: { task: "attention_check", cycle: c.cycle, condition },
      on_finish: (data) => {
        const r = results[c.cycle];
        const pred = r[condition + "_prediction"];
        const actual = r[condition + "_correct"];
        data.choice = CHECK_KEYS[data.response];
        data.prediction = pred ?? null;
        data.actual = actual;
        data.expected = pred === null || pred === undefined ? null : pred > actual ? "higher" : pred < actual ? "lower" : "same";
        data.passed = data.expected === null ? null : data.choice === data.expected;
      },
    };
  }

  // Exp 2-5 asked why performance differed after the Cycle 2 feedback (five options, Table 3).
  // The article names three of them; the two marked TODO are placeholders to confirm with the
  // authors (ask for Table 3's wording in the materials email).
  const attribution = (c) => ({
    type: jsPsychSurvey,
    survey_json: {
      showQuestionNumbers: "off",
      completeText: "Continue",
      pages: [{
        elements: [{
          type: "radiogroup", name: "attribution",
          title: "What do you think best explains the difference (or lack of a difference) between your memory for the read pairs and the pretested pairs?",
          choices: [
            { value: "method", text: "One learning method (reading or pretesting) is more effective than the other" },
            { value: "lucky_guesses", text: "Lucky guesses" },
            { value: "item_difficulty", text: "Some word pairs were easier than others" },          // TODO confirm with authors
            { value: "attention", text: "I paid more attention to some word pairs than to others" }, // TODO confirm with authors
          ],
          showOtherItem: true, otherText: "Other (please describe)",
        }],
      }],
    },
    data: { task: "attribution", cycle: c.cycle },
    on_finish: (data) => {
      data.attribution = (data.response && data.response.attribution) || null;
      data.attribution_other = (data.response && data.response["attribution-Comment"]) || null;
    },
  });

  function cycleTimeline(c) {
    const timeline = [
      studyInstructions(c),
      studyPhase(c),
      predictions(c),
      distractor(c),
      testPhase(c),
    ];
    if (c.cycle === 1) {
      const checks = jsPsych.randomization.shuffle(["read", "pretest"]);
      timeline.push(
        feedbackScreen(c, { withPredictions: true, viewing: 1 }),
        predictionCheck(c, checks[0]),
        predictionCheck(c, checks[1]),
        feedbackScreen(c, { withPredictions: true, viewing: 2 }),
      );
    } else {
      timeline.push(feedbackScreen(c, { withPredictions: false, viewing: 1 }), attribution(c));
    }
    return { timeline };
  }

  // -------------------------------------------------------------------------
  // Exit questions (as in the original), feedback, debrief
  // -------------------------------------------------------------------------
  const exitQuestions = {
    type: jsPsychSurvey,
    survey_json: {
      showQuestionNumbers: "off",
      completeText: "Continue",
      pages: [{
        elements: [
          {
            type: "rating", name: "read_effectiveness", rateMin: 0, rateMax: 10, displayMode: "buttons",
            title: "How effective was reading for learning the word pairs?",
            minRateDescription: "Utterly ineffective", maxRateDescription: "Completely effective",
          },
          {
            type: "rating", name: "pretest_effectiveness", rateMin: 0, rateMax: 10, displayMode: "buttons",
            title: "How effective was pretesting (guessing the missing word first) for learning the word pairs?",
            minRateDescription: "Utterly ineffective", maxRateDescription: "Completely effective",
          },
          {
            type: "radiogroup", name: "preference",
            title: "If you had to learn a new list of word pairs, which technique would you prefer to use?",
            choices: [{ value: "read", text: "Reading" }, { value: "pretest", text: "Pretesting" }],
          },
        ],
      }],
    },
    data: { task: "exit_questions" },
  };

  const feedback = {
    type: jsPsychSurveyLikert,
    questions: [{
      prompt: "How clear were the instructions?", name: "instructions_clear", required: false,
      labels: ["Very unclear", "Unclear", "Neutral", "Clear", "Very clear"],
    }],
    data: { task: "feedback_likert" },
  };
  const comments = {
    type: jsPsychSurveyText,
    questions: [{ prompt: "Any comments about the study? Did anything not work? (optional)", name: "comments", rows: 4 }],
    data: { task: "feedback_text" },
  };

  const debrief = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <h2>Debrief</h2>
      <p>Thank you for taking part. This study examined whether people come to recognize the
      benefit of "pretesting" (trying to guess an answer before seeing it), which usually improves
      memory more than reading does, after seeing their own results compared with their predictions.</p>
      <p>Please do not share what this study is about with anyone who might take part, so that their
      responses are not affected. If you have questions about this research, contact
      <a href="mailto:${EXPERIMENT.contact_email}">${EXPERIMENT.contact_email}</a>.</p>
      <p>Press the button to save your responses and finish.</p>`,
    choices: ["Finish"],
    data: { task: "debrief" },
  };

  await jsPsych.run([
    consent,
    welcome,
    demographics,
    cycleTimeline(cycles[0]),
    {
      type: jsPsychInstructions,
      pages: [`<h2>Round 2</h2><p>Round 2 works exactly like Round 1, with 32 new word pairs.</p>`],
      show_clickable_nav: true,
      data: { task: "instructions" },
    },
    cycleTimeline(cycles[1]),
    exitQuestions,
    feedback,
    comments,
    debrief,
  ]);
})();
