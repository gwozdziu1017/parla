  const APP_VERSION = '1.3.2';

  /* ================================ */
  /* STATE                            */
  /* ================================ */
  const TUTORS = {
    claire: {
      name: 'Claire Diction', role: 'Strict teacher', init: 'C',
      voice: 'nova',
      greeting: "Right, let's get started. I'll be straight with you — I'll correct every mistake. That's what you're here for.",
    },
    grace: {
      name: 'Grace Fullspeak', role: 'Colleague', init: 'G',
      voice: 'shimmer',
      greeting: "Hey! Great to meet you. Let's just chat and I'll help you along the way.",
    },
    wayne: {
      name: 'Wayne Kerr', role: 'Colleague', init: 'W',
      voice: 'echo',
      greeting: "Alright mate, let's do this. Don't worry, I won't bite — much.",
    },
    ben: {
      name: 'Ben Dover', role: 'Debate partner', init: 'B',
      voice: 'onyx',
      greeting: "So. You want to debate. Good. I hope you came prepared because I won't go easy on you.",
    },
  };

  // Home screen selections — in-memory only, reset each app load
  let activeTutor          = 'grace';
  let selectedPersonality  = 'mate';   // teacher | mate | debate | guided | custom
  let customTutorDesc      = '';
  let selectedLevel        = 'intermediate'; // beginner | intermediate | native (always beginner in guided)

  const GUIDE_LABELS = ["Guide me", "Help me out", "Show me how", "Give me a hint", "Walk me through it"];

  // Session state
  let sessionState         = 'idle';   // idle | loading | speaking | listening
  let sessionStarted       = false;
  let sessionActive        = false;    // false = loop should stop
  let sessionCost          = 0;
  let recognition          = null;
  let silenceTimer         = null;
  let interimEl            = null;
  let accumTranscript      = '';
  let conversationHistory  = [];       // [{role, content}] sent to Claude
  let firstTurn            = true;     // skip releaseAudioSession after greeting
  let audioContext         = null;
  let currentAudioSource      = null;  // currently playing BufferSourceNode
  let currentSessionId        = 0;     // incremented each session; async callbacks check this to discard stale audio
  let guideRequestInProgress  = false; // true while Guide me tap is being processed
  let wakeLock             = null;

  async function requestWakeLock() {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) {
      console.log('WakeLock not supported:', e);
    }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release();
      wakeLock = null;
    }
  }

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && sessionActive) {
      await requestWakeLock();
    }
  });

  /* ================================ */
  /* NAVIGATION                       */
  /* ================================ */
  function nav(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    if (screenId === 'settings-screen') refreshSettingsUI();
    if (screenId === 'vocab-screen')    renderVocab();
  }

  /* ================================ */
  /* HOME — TUTOR SELECTION           */
  /* ================================ */
  function selectTutor(el) {
    document.querySelectorAll('.tutor-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    activeTutor = el.dataset.tutor;
  }

  /* ================================ */
  /* HOME — PERSONALITY + FORMALITY   */
  /* ================================ */
  function selectPersonality(el) {
    document.querySelectorAll('.pers-pill').forEach(p => p.classList.remove('selected'));
    el.classList.add('selected');
    selectedPersonality = el.dataset.personality;
    updateHomeCollapsibles();
  }

  function updateHomeCollapsibles() {
    const p = selectedPersonality;
    const isGuided = p === 'guided';
    const isCustom = p === 'custom';
    // Show guided note only for guided
    setOpen('guided-section', isGuided);
    // Show textarea only for custom
    setOpen('custom-section', isCustom);
    // Hide level selector in guided mode
    setOpen('level-section', !isGuided);
  }

  function setOpen(id, open) {
    document.getElementById(id)?.classList.toggle('open', open);
  }


  function onCustomTutorInput(el) {
    customTutorDesc = el.value;
  }

  function selectHomeLevel(btn) {
    document.querySelectorAll('#home-level-tabs .seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedLevel = btn.dataset.level;
  }

  /* ================================ */
  /* SETTINGS CONTROLS                */
  /* ================================ */
  function selectLevel(btn) {
    document.querySelectorAll('#level-tabs .seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    persist();
  }

  function selectCorr(btn) {
    document.querySelectorAll('#corr-tabs .seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    persist();
  }

  function onSlider(input) {
    const secs = (input.value / 10).toFixed(1) + 's';
    document.getElementById('pause-val').textContent = secs;
    persist();
  }

  function refreshSettingsUI() {
    const monthly = parseFloat(localStorage.getItem('parla_monthly') || '0');
    document.getElementById('s-monthly-cost').textContent = '$' + monthly.toFixed(3);
    document.getElementById('s-session-cost').textContent = '$0.000';
  }

  function resetMonthly() {
    localStorage.setItem('parla_monthly', '0');
    document.getElementById('s-monthly-cost').textContent = '$0.000';
  }

  /* ================================ */
  /* PERSISTENCE (localStorage)       */
  /* ================================ */
  function persist() {
    const activeCorr = document.querySelector('#corr-tabs .seg-btn.active');
    const slider     = document.getElementById('pause-slider');

    const data = {
      nativeLang:   document.getElementById('native-lang')?.value || '',
      pauseVal:     slider?.value || '20',
      corrStyle:    activeCorr?.dataset.corr || 'brief',
      anthropicKey: document.getElementById('anthropic-key')?.value || '',
      openaiKey:    document.getElementById('openai-key')?.value    || '',
    };
    localStorage.setItem('parla_settings', JSON.stringify(data));
    // Only overwrite standalone API key entries when the user has actually typed a value.
    // This prevents any other persist() call (theme change, slider, etc.) from
    // accidentally wiping keys that were stored in a previous session.
    if (data.anthropicKey) localStorage.setItem('anthropic_api_key', data.anthropicKey);
    if (data.openaiKey)    localStorage.setItem('openai_api_key',    data.openaiKey);
  }

  function restore() {
    const raw = localStorage.getItem('parla_settings');
    let d = {};
    if (raw) { try { d = JSON.parse(raw); } catch {} }

    // Settings screen fields
    if (d.nativeLang) document.getElementById('native-lang').value = d.nativeLang;
    if (d.pauseVal) {
      const sl = document.getElementById('pause-slider');
      sl.value = d.pauseVal;
      onSlider(sl);
    }
    if (d.corrStyle) {
      document.querySelectorAll('#corr-tabs .seg-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.corr === d.corrStyle));
    }
    const storedAnthropic = localStorage.getItem('anthropic_api_key') || d.anthropicKey || '';
    if (storedAnthropic) document.getElementById('anthropic-key').value = storedAnthropic;
    const storedOpenAI    = localStorage.getItem('openai_api_key')    || d.openaiKey    || '';
    if (storedOpenAI)    document.getElementById('openai-key').value    = storedOpenAI;
  }

  /* ================================ */
  /* SESSION                          */
  /* ================================ */
  function getTutorGreeting() {
    if (selectedPersonality === 'guided') {
      return "Cześć! Let's practice English together. Jestem tutaj, żeby ci pomóc. I'm here to help. If you need a hint, tap 'Guide me'. Ready? How are you today?";
    }
    return TUTORS[activeTutor].greeting;
  }

  function startSession() {
    const t = TUTORS[activeTutor];
    document.getElementById('sess-name').textContent = t.name;
    const roleLabels = { teacher: 'Teacher', mate: 'Mate', debate: 'Debate Partner', guided: 'Guided · Bilingual', custom: 'Custom tutor' };
    document.getElementById('sess-role').textContent = roleLabels[selectedPersonality] || selectedPersonality;

    // reset session state — stop any in-flight audio first
    currentSessionId++;
    guideRequestInProgress = false;
    stopAudio();
    sessionActive       = false;
    sessionStarted      = false;
    sessionCost         = 0;
    conversationHistory = [];
    firstTurn           = true;
    stopListening();
    sessionState = 'idle';
    applyState();
    updateCostDisplay();

    const log = document.getElementById('conv-log');
    log.innerHTML = '<div class="conv-empty-msg" id="conv-empty">Your conversation will appear here</div>';

    nav('session-screen');
  }

  function endSession() {
    currentSessionId++;
    guideRequestInProgress = false;
    sessionActive = false;
    releaseWakeLock();
    stopListening();
    stopAudio();
    sessionStarted = false;
    sessionState   = 'idle';
    applyState();
    nav('home-screen');
  }

  function onMainBtnTap() {
    // Block during active states
    if (sessionState === 'loading' || sessionState === 'speaking' || sessionState === 'listening') return;

    if (!sessionStarted) {
      // Unlock AudioContext on iOS — must happen synchronously inside the gesture handler
      const ctx = getAudioContext();
      ctx.resume().catch(() => {});

      sessionStarted = true;
      sessionActive  = true;
      requestWakeLock();
      console.log('[Parla] onMainBtnTap — calling speak() with greeting');
      // 600ms pause before greeting so it doesn't fire instantly
      setTimeout(() => speak(getTutorGreeting()), 600);
    }
  }

  function applyState() {
    const ring  = document.getElementById('btn-ring');
    const btn   = document.getElementById('main-btn');
    const icon  = document.getElementById('btn-icon');
    const label = document.getElementById('btn-label');
    const hint  = document.getElementById('sess-hint');

    // remove all state classes
    ring.className = 'session-btn-ring';
    ring.classList.add('state-' + sessionState);

    if (sessionState === 'idle') {
      icon.innerHTML = `
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8"  y1="23" x2="16" y2="23"/>`;
      label.textContent   = sessionStarted ? 'TAP TO SPEAK' : 'TAP TO START';
      hint.textContent    = sessionStarted ? 'Tap when you\u2019re ready to speak' : 'Tap the button to begin your session';
      btn.setAttribute('aria-label', 'Start session');

    } else if (sessionState === 'loading') {
      icon.innerHTML = `<path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>`;
      label.textContent   = 'LOADING';
      hint.textContent    = 'Fetching audio\u2026';
      btn.setAttribute('aria-label', 'Loading audio');

    } else if (sessionState === 'speaking') {
      icon.innerHTML = `
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>`;
      label.textContent   = 'SPEAKING';
      hint.textContent    = 'Your tutor is speaking\u2026';
      btn.setAttribute('aria-label', 'Tutor is speaking');

    } else if (sessionState === 'listening') {
      icon.innerHTML = `
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8"  y1="23" x2="16" y2="23"/>`;
      label.textContent   = 'LISTENING';
      hint.textContent    = 'Your turn \u2014 speak now';
      btn.setAttribute('aria-label', 'Listening — tap to stop');
    }

    // Guide float button: visible only in guided mode during listening
    const guideBtn = document.getElementById('guide-float-btn');
    if (guideBtn) {
      guideBtn.classList.toggle('visible',
        selectedPersonality === 'guided' && sessionState === 'listening' && sessionActive);
    }
  }

  /* ================================ */
  /* TTS                              */
  /* ================================ */
  function getAudioContext() {
    if (!audioContext || audioContext.state === 'closed') {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
  }

  async function speak(text) {
    const mySessionId = currentSessionId; // capture — used to detect stale callbacks
    const openaiKey = localStorage.getItem('openai_api_key')?.trim();
    if (!openaiKey) {
      alert('Please add your OpenAI API key in Settings.');
      sessionStarted = false;
      return;
    }

    sessionState = 'loading';
    applyState();

    console.log('[Parla] speak() called:', text.slice(0, 60));

    try {
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          voice: TUTORS[activeTutor].voice,
          input: text,
        }),
      });

      if (mySessionId !== currentSessionId) { console.log('[Parla] speak() discarded (session ended)'); return; }

      if (!response.ok) {
        let msg = `API error ${response.status}`;
        try { const e = await response.json(); msg = e.error?.message || msg; } catch {}
        throw new Error(msg);
      }

      // Track cost: $15 per 1M characters
      addCost(text.length * 15 / 1_000_000);

      appendMessage('tutor', text);
      // 400ms "thinking" pause before audio plays — feels more natural
      await new Promise(resolve => setTimeout(resolve, 400));
      if (mySessionId !== currentSessionId) { console.log('[Parla] speak() discarded during pre-play pause'); return; }
      sessionState = 'speaking';
      applyState();

      const arrayBuffer = await response.arrayBuffer();
      if (mySessionId !== currentSessionId) { console.log('[Parla] speak() discarded after fetch (session ended)'); return; }

      const ctx = getAudioContext();

      // Always resume — context may be suspended from previous session cleanup or iOS init
      console.log('[Parla] AudioContext state before resume:', ctx.state);
      await ctx.resume();
      console.log('[Parla] AudioContext state after resume:', ctx.state);

      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      if (mySessionId !== currentSessionId) { console.log('[Parla] speak() discarded after decode (session ended)'); return; }

      await new Promise((resolve) => {
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        currentAudioSource = source;
        source.onended = () => {
          if (currentAudioSource === source) currentAudioSource = null;
          // Suspend context after playback — releases iOS audio session for mic
          ctx.suspend().then(resolve);
        };
        console.log('[Parla] Starting audio playback');
        source.start(0);
      });

      if (mySessionId !== currentSessionId) { console.log('[Parla] speak() discarded after playback (session ended)'); return; }

      // Playback finished — transition to next turn
      // 200ms breath pause + 2000ms standard delay = 2200ms total before mic opens
      if (sessionActive) {
        if (firstTurn) {
          firstTurn = false;
          setTimeout(() => startListening(), 2200);
        } else {
          await new Promise(resolve => setTimeout(resolve, 2200));
          startListening();
        }
      } else {
        sessionState = 'idle';
        applyState();
      }

    } catch (err) {
      if (mySessionId !== currentSessionId) return; // session ended mid-error
      speak('Sorry, I had a problem connecting. The error was: ' + err.message);
    }
  }

  /* ================================ */
  /* SPEECH RECOGNITION (STT)         */
  /* ================================ */
  function getPauseSensitivityMs() {
    const settings = JSON.parse(localStorage.getItem('parla_settings') || '{}');
    const raw = parseFloat(settings.pauseVal || '20');
    return (raw / 10) * 1000; // e.g. 20 → 2000ms, 30 → 3000ms
  }

  function startListening() {
    if (!sessionActive) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert('Speech recognition is not supported on this browser.');
      endSession();
      return;
    }

    accumTranscript = '';

    // Interim bubble
    const log = document.getElementById('conv-log');
    const empty = document.getElementById('conv-empty');
    if (empty) empty.remove();
    interimEl = document.createElement('div');
    interimEl.className = 'conv-msg user';
    interimEl.innerHTML = '<div class="conv-bubble conv-bubble-interim">\u00a0</div>';
    log.appendChild(interimEl);
    log.scrollTop = log.scrollHeight;

    sessionState = 'listening';
    applyState();

    recognition = new SR();
    recognition.lang            = 'en-US';
    recognition.continuous      = false;
    recognition.interimResults  = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (e) => {
      let interim = '';
      let final   = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) { final += t; }
        else                      { interim += t; }
      }

      accumTranscript = final || interim;

      // Update interim bubble
      const bubble = interimEl?.querySelector('.conv-bubble');
      if (bubble) {
        bubble.textContent = accumTranscript;
        bubble.classList.toggle('conv-bubble-interim', !final);
      }
      log.scrollTop = log.scrollHeight;

      // EOT keyword — end turn immediately regardless of final/interim
      if (/\beot\b/i.test(accumTranscript)) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
        try { recognition.stop(); } catch {}
        return;
      }

      // On final result, stop — no need to wait for silence timer
      if (final) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
        try { recognition.stop(); } catch {}
        return;
      }

      // Interim: reset silence timer with extra buffer so words don't get cut off
      // Guided mode gets extra patience (5s) to let beginners think
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        try { recognition.stop(); } catch {}
      }, getSilenceThreshold(selectedPersonality));
    };

    recognition.onend = () => {
      clearTimeout(silenceTimer);
      silenceTimer = null;
      recognition = null;

      if (!sessionActive || guideRequestInProgress) {
        if (interimEl) { interimEl.remove(); interimEl = null; }
        return;
      }

      const transcript = stripEOT(accumTranscript);
      if (transcript.trim().length > 0) {
        onSpeechResult(transcript);
      } else {
        // Nothing heard (or only EOT) — remove empty interim bubble and listen again
        if (interimEl) { interimEl.remove(); interimEl = null; }
        setTimeout(() => startListening(), 400);
      }
    };

    recognition.onerror = (e) => {
      clearTimeout(silenceTimer);
      silenceTimer = null;
      if (interimEl) { interimEl.remove(); interimEl = null; }
      // onend will still fire after onerror, so we set recognition=null here
      // to prevent double-processing in onend
      recognition = null;

      if (!sessionActive) return;

      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        alert('Microphone access denied. Please allow microphone access in your browser settings, then try again.');
        endSession();
        return;
      }
      // no-speech, aborted, network — restart after a short pause
      setTimeout(() => startListening(), 500);
    };

    // Refresh guide button label each turn (guided mode only)
    const guideBtn = document.getElementById('guide-float-btn');
    if (guideBtn && selectedPersonality === 'guided') {
      guideBtn.textContent = GUIDE_LABELS[Math.floor(Math.random() * GUIDE_LABELS.length)];
    }

    try {
      recognition.start();
    } catch (err) {
      // Already started or other edge case — retry
      if (interimEl) { interimEl.remove(); interimEl = null; }
      setTimeout(() => startListening(), 500);
    }
  }

  function stopListening() {
    clearTimeout(silenceTimer);
    silenceTimer = null;
    if (recognition) {
      try { recognition.abort(); } catch {}
      recognition = null;
    }
    if (interimEl) { interimEl.remove(); interimEl = null; }
  }

  async function onGuideBtn() {
    if (!sessionActive || guideRequestInProgress) return;
    guideRequestInProgress = true;

    // Immediately kill mic, silence timer, and accumulated transcript so
    // onend fires cleanly without triggering a second speech result
    clearTimeout(silenceTimer);
    silenceTimer = null;
    accumTranscript = '';
    if (recognition) {
      try { recognition.stop(); } catch(e) {}
    }

    // Hide button immediately so it can't be double-tapped
    const guideBtn = document.getElementById('guide-float-btn');
    if (guideBtn) guideBtn.classList.remove('visible');

    sessionState = 'loading';
    applyState();
    try {
      const raw = await askClaude('[GUIDE_REQUEST]');
      if (!raw || !sessionActive) { guideRequestInProgress = false; return; }
      const cleaned = handleVocabSave(raw);
      // speak() will restart listening after playback; reset flag then
      guideRequestInProgress = false;
      speak(cleaned);
    } catch (err) {
      guideRequestInProgress = false;
      speak('Sorry, I had a problem. The error was: ' + err.message);
    }
  }

  function stopAudio() {
    if (currentAudioSource) {
      try { currentAudioSource.stop(); } catch(e) {}
      currentAudioSource = null;
    }
    if (audioContext && audioContext.state !== 'closed') {
      try { audioContext.suspend(); } catch {}
    }
  }

  async function isCompleteSentence(transcript) {
    // Safety: anything over 3 words is always treated as complete — avoids
    // over-aggressive incomplete classification from the model
    const wordCount = transcript.trim().split(/\s+/).length;
    if (wordCount > 3) {
      console.log('[GUIDED] Word count > 3, skipping completeness check — treating as complete');
      return true;
    }

    const apiKey = localStorage.getItem('anthropic_api_key') || '';
    if (!apiKey) return true; // fail open
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key':                              apiKey,
          'anthropic-version':                      '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          'content-type':                           'application/json',
        },
        body: JSON.stringify({
          model:      'claude-sonnet-4-20250514',
          max_tokens: 5,
          system:     'Does this English sentence feel complete or unfinished? Reply with one word only: complete or incomplete.',
          messages:   [{ role: 'user', content: transcript }],
        }),
      });
      if (!response.ok) {
        console.log('[GUIDED] Completeness check API error', response.status, '— defaulting to complete');
        return true; // fail open
      }
      const data = await response.json();
      const word = (data.content?.[0]?.text || '').trim().toLowerCase();
      console.log('[GUIDED] Completeness API raw response:', JSON.stringify(word));
      return word !== 'incomplete';
    } catch (e) {
      console.log('[GUIDED] Completeness check threw:', e.message, '— defaulting to complete');
      return true; // fail open
    }
  }

  async function onSpeechResult(transcript) {
    if (interimEl) { interimEl.remove(); interimEl = null; }

    if (selectedPersonality === 'guided') {
      console.log('[GUIDED] Sending to Claude:', JSON.stringify(transcript));
    }

    appendMessage('user', transcript);

    sessionState = 'loading';
    applyState();

    try {
      const raw = await askClaude(transcript);
      if (!raw || !sessionActive) return;

      const cleaned = handleVocabSave(raw);
      console.log('[Parla] Claude response received, calling speak():', cleaned.slice(0, 60));
      speak(cleaned);
    } catch (err) {
      speak('Sorry, I had a problem connecting. The error was: ' + err.message);
    }
  }

  /* ================================ */
  /* CLAUDE API                        */
  /* ================================ */
  // Look up a tutor's TTS voice by their display name
  function getVoiceForTutor(name) {
    const tutor = Object.values(TUTORS).find(t => t.name === name);
    return tutor ? tutor.voice : null;
  }

  // Extract EOT keyword from a transcript (pure function, testable)
  function stripEOT(transcript) {
    return transcript.replace(/[,.]?\s*\beot\b\s*[,.]?/gi, ' ').trim();
  }

  // Return silence threshold ms for a given personality (testable)
  function getSilenceThreshold(personality) {
    return personality === 'guided' ? 5000 : getPauseSensitivityMs() + 1000;
  }

  // Simple getters/setters for session state (needed for testing)
  function getSessionState() { return sessionState; }
  function setSessionState(state) { sessionState = state; }

  // Accept optional params so tests can call it without touching globals
  function buildSystemPrompt(tutorNameParam, personalityParam, levelParam, customDescParam) {
    const personality = personalityParam !== undefined ? personalityParam : selectedPersonality;
    const level       = levelParam       !== undefined ? levelParam       : selectedLevel;
    const customDesc  = customDescParam  !== undefined ? customDescParam  : customTutorDesc;
    const tutor = tutorNameParam !== undefined
      ? (Object.values(TUTORS).find(t => t.name === tutorNameParam) || TUTORS[activeTutor])
      : TUTORS[activeTutor];
    const isGuided = personality === 'guided';

    // ── GUIDED MODE ───────────────────────────────────────────────────────────
    if (isGuided) {
      return `You are ${tutor.name}, an English tutor in a voice app called Parla. You are teaching a complete beginner Polish native speaker.

GUIDED MODE RULES:
- Always start your turn by asking a question or making a statement in Polish first, then immediately translate it to English
- Format: say the Polish version, then say "That means:" followed by the English version
- Wait for the student to answer in English
- If the student's answer is correct or close, gently confirm and move on
- If you receive [GUIDE_REQUEST], provide a model answer in Polish first, then in English, then wait for the student to repeat it in English
- When student repeats, give a gentle nudge if needed but accept reasonable attempts and move on
- Keep everything simple, warm and encouraging
- Short sentences only, basic vocabulary
- Never overwhelm with multiple corrections at once

No markdown, no lists.`;
    }

    // ── TUTOR IDENTITY ────────────────────────────────────────────────────────
    const tutorBlock = `You are ${tutor.name}, an English tutor in a voice conversation app called Parla.`;

    // ── PERSONALITY BLOCK ────────────────────────────────────────────────────
    let personalityBlock;
    if (personality === 'mate') {
      personalityBlock = `You are a talkative, friendly companion. You love asking questions, sharing short stories from your own experience, and keeping the conversation light and fun. React naturally — laugh, express surprise, share opinions. Correct only serious mistakes that change meaning, maximum 1 correction per response.`;
    } else if (personality === 'teacher') {
      personalityBlock = `You are a strict, precise English teacher. You care deeply about correct grammar and vocabulary. Correct every mistake — grammar, vocabulary, awkward phrasing. Explain briefly why something is wrong. Keep corrections constructive and clear.`;
    } else if (personality === 'debate') {
      personalityBlock = `You are an opinionated debate partner. You always take the opposite view, challenge assumptions, push back on weak arguments, and demand evidence. Correct clear grammar mistakes but keep the debate energy high.`;
    } else if (personality === 'custom' && customDesc.trim()) {
      personalityBlock = `${customDesc.trim()} Also correct clear grammar and vocabulary mistakes naturally as part of your responses.`;
    } else {
      personalityBlock = `You are a talkative, friendly companion. Correct only serious mistakes that change meaning, maximum 1 correction per response.`;
    }

    // ── LEVEL BLOCK ───────────────────────────────────────────────────────────
    let levelBlock;
    if (level === 'beginner') {
      levelBlock = `Student level: A1-A2. Use simple, short sentences. Avoid idioms and complex grammar. Maximum 1 correction per response, only for serious errors.`;
    } else if (level === 'native') {
      levelBlock = `Student level: C1-C2. Rich sophisticated vocabulary is expected. Correct mistakes including subtle ones — collocations, register, awkward phrasing. Up to 3 corrections per response.`;
    } else {
      levelBlock = `Student level: B1-B2. Natural everyday English. Correct clear grammar and unnatural phrasing. Up to 2 corrections per response.`;
    }

    // ── SHARED RULES ──────────────────────────────────────────────────────────
    const sharedRules = `CONVERSATION RULES:
- Keep responses short — 2-4 sentences max, this is a voice conversation
- Talk naturally like a real person, not a textbook
- Never use bullet points, lists, or markdown — spoken word only
- Continue the conversation naturally after corrections

VOCABULARY:
- If the user says "write it down" or "save that" or similar, respond with exactly this format at the end of your response: [SAVE_WORD: word | example: example sentence | note: usage note]
- Otherwise never include that tag

Respond only in plain spoken English. No formatting, no lists, no markdown.`;

    return `${tutorBlock}

${personalityBlock}

${levelBlock}

${sharedRules}`;
  }

  async function askClaude(userText) {
    const apiKey = localStorage.getItem('anthropic_api_key') || '';
    if (!apiKey) {
      alert('Please add your Anthropic API key in Settings first.');
      endSession();
      return null;
    }

    conversationHistory.push({ role: 'user', content: userText });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':                              apiKey,
        'anthropic-version':                      '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type':                           'application/json',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system:     buildSystemPrompt(),
        messages:   conversationHistory,
      }),
    });

    if (!response.ok) {
      let msg = `Claude API error ${response.status}`;
      try { const e = await response.json(); msg = e.error?.message || msg; } catch {}
      conversationHistory.pop(); // remove the user turn we just pushed
      throw new Error(msg);
    }

    const data       = await response.json();
    const replyText  = data.content?.[0]?.text || '';

    // Cost: $3/M input tokens, $15/M output tokens
    const inputCost  = (data.usage?.input_tokens  || 0) * 3  / 1_000_000;
    const outputCost = (data.usage?.output_tokens || 0) * 15 / 1_000_000;
    addCost(inputCost + outputCost);

    conversationHistory.push({ role: 'assistant', content: replyText });

    return replyText;
  }

  function handleVocabSave(text) {
    const match = text.match(/\[SAVE_WORD:\s*([^|]+)\|\s*example:\s*([^|]+)\|\s*note:\s*([^\]]+)\]/i);
    if (match) {
      const word    = match[1].trim();
      const example = match[2].trim();
      const note    = match[3].trim();
      const date    = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

      const vocab = JSON.parse(localStorage.getItem('vocabulary_notebook') || '[]');
      vocab.unshift({ word, example, note, date });
      localStorage.setItem('vocabulary_notebook', JSON.stringify(vocab));
    }
    return text.replace(/\[SAVE_WORD:[^\]]+\]/gi, '').trim();
  }

  function appendMessage(from, text) {
    const log   = document.getElementById('conv-log');
    const empty = document.getElementById('conv-empty');
    if (empty) empty.remove();

    const display = (from === 'user' && text === '[GUIDE_REQUEST]') ? '💡 Guide me' : text;
    const safe = display.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const el = document.createElement('div');
    el.className = `conv-msg ${from}`;
    el.innerHTML = `<div class="conv-bubble">${safe}</div>`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  function addCost(amount) {
    sessionCost += amount;
    updateCostDisplay();
    const monthly = parseFloat(localStorage.getItem('parla_monthly') || '0') + amount;
    localStorage.setItem('parla_monthly', monthly.toFixed(6));
  }

  function updateCostDisplay() {
    document.getElementById('sess-cost').textContent = '$' + sessionCost.toFixed(3);
  }

  /* ================================ */
  /* VOCABULARY                       */
  /* ================================ */
  const DEMO_WORDS = [
    {
      word: 'Eloquent',
      example: 'She gave an eloquent speech that moved the entire audience.',
      note: "Used to describe fluent, persuasive, and expressive speech or writing. Often used to compliment someone's communication style.",
      date: 'Mar 28',
    },
    {
      word: 'Meticulous',
      example: 'He was meticulous in his preparation for every presentation.',
      note: 'Showing great attention to detail; careful and precise. Slightly more formal than "thorough".',
      date: 'Mar 29',
    },
    {
      word: 'Candid',
      example: 'I appreciate your candid feedback — it really helped me improve.',
      note: 'Truthful and straightforward, even if the truth is uncomfortable. A positive word in most contexts.',
      date: 'Mar 30',
    },
  ];

  function renderVocab() {
    const body  = document.getElementById('vocab-body');
    const words = JSON.parse(localStorage.getItem('vocabulary_notebook') || 'null') || DEMO_WORDS;

    if (!words.length) {
      body.innerHTML = `
        <div class="vocab-empty">
          <div class="vocab-empty-icon">
            <svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          </div>
          <div class="vocab-empty-title">No words yet</div>
          <div class="vocab-empty-sub">Words saved during your sessions will appear here with examples and usage notes.</div>
        </div>`;
      return;
    }

    const list = document.createElement('div');
    list.className = 'vocab-list';

    words.forEach((w, i) => {
      const item = document.createElement('div');
      item.className = 'vocab-item';
      item.dataset.idx = i;
      item.innerHTML = `
        <div class="vocab-item-head" onclick="toggleWord(${i})">
          <span class="vocab-word">${w.word}</span>
          <span class="vocab-date">${w.date}</span>
          <svg class="vocab-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="vocab-item-body">
          <p class="vocab-field-label">Example sentence</p>
          <p class="vocab-field-text example">"${w.example}"</p>
          <p class="vocab-field-label">Usage note</p>
          <p class="vocab-field-text">${w.note}</p>
        </div>`;
      list.appendChild(item);
    });

    body.innerHTML = '';
    body.appendChild(list);
  }

  function toggleWord(idx) {
    const item = document.querySelector(`.vocab-item[data-idx="${idx}"]`);
    if (item) item.classList.toggle('open');
  }

  /* ================================ */
  /* THEMES                           */
  /* ================================ */
  const THEMES = {
    A: {
      name: 'Early morning coffee',
      vars: {
        '--bg':             '#0f0e0c',
        '--bg-card':        '#181714',
        '--bg-elevated':    '#211f1c',
        '--bg-input':       '#1c1a17',
        '--accent':         '#c8a96e',
        '--accent-dim':     'rgba(200,169,110,0.12)',
        '--accent-border':  'rgba(200,169,110,0.28)',
        '--accent-glow':    'rgba(200,169,110,0.18)',
        '--accent-muted':   'rgba(200,169,110,0.55)',
        '--text-primary':   '#f0ede8',
        '--text-secondary': '#8a8680',
        '--text-muted':     '#46413b',
        '--border':         'rgba(255,255,255,0.06)',
        '--border-strong':  'rgba(255,255,255,0.10)',
        '--btn-bg':         '#c8a96e',
        '--btn-text':       '#0f0e0c',
        '--title-weight':   '400',
        '--title-style':    'italic',
        '--title-transform':'none',
        '--slider-track':   '#211f1c',
        '--guided-accent':     '#6e9ec8',
        '--guided-accent-rgb': '110, 158, 200',
        '--radius-lg':      '16px',
        '--radius':         '12px',
        '--radius-sm':      '8px',
      },
      swatch: { bg: '#0f0e0c', accent: '#c8a96e' },
    },
    B: {
      name: 'Deep blue night',
      vars: {
        '--bg':             '#080c14',
        '--bg-card':        '#0d1424',
        '--bg-elevated':    '#14203a',
        '--bg-input':       '#0b1220',
        '--accent':         '#4d8ef0',
        '--accent-dim':     'rgba(77,142,240,0.12)',
        '--accent-border':  'rgba(77,142,240,0.28)',
        '--accent-glow':    'rgba(77,142,240,0.18)',
        '--accent-muted':   'rgba(77,142,240,0.55)',
        '--text-primary':   '#e8eef8',
        '--text-secondary': '#6a90b0',
        '--text-muted':     '#4a6080',
        '--border':         'rgba(255,255,255,0.05)',
        '--border-strong':  'rgba(255,255,255,0.09)',
        '--btn-bg':         '#4d8ef0',
        '--btn-text':       '#080c14',
        '--title-weight':   '400',
        '--title-style':    'italic',
        '--title-transform':'none',
        '--slider-track':   '#14203a',
        '--guided-accent':     '#50c8a0',
        '--guided-accent-rgb': '80, 200, 160',
        '--radius-lg':      '16px',
        '--radius':         '12px',
        '--radius-sm':      '8px',
      },
      swatch: { bg: '#080c14', accent: '#4d8ef0' },
    },
    C: {
      name: 'Forest green',
      vars: {
        '--bg':             '#090e0a',
        '--bg-card':        '#0e1a0f',
        '--bg-elevated':    '#162618',
        '--bg-input':       '#0c1810',
        '--accent':         '#5aad5e',
        '--accent-dim':     'rgba(90,173,94,0.12)',
        '--accent-border':  'rgba(90,173,94,0.28)',
        '--accent-glow':    'rgba(90,173,94,0.18)',
        '--accent-muted':   'rgba(90,173,94,0.55)',
        '--text-primary':   '#e8f0e8',
        '--text-secondary': '#6a9a6c',
        '--text-muted':     '#4a6e4c',
        '--border':         'rgba(255,255,255,0.05)',
        '--border-strong':  'rgba(255,255,255,0.09)',
        '--btn-bg':         '#5aad5e',
        '--btn-text':       '#090e0a',
        '--title-weight':   '400',
        '--title-style':    'italic',
        '--title-transform':'none',
        '--slider-track':   '#162618',
        '--guided-accent':     '#9e7ec8',
        '--guided-accent-rgb': '158, 126, 200',
        '--radius-lg':      '16px',
        '--radius':         '12px',
        '--radius-sm':      '8px',
      },
      swatch: { bg: '#090e0a', accent: '#5aad5e' },
    },
    D: {
      name: 'Busy Manhattan',
      vars: {
        '--bg':             '#3e3c38',
        '--bg-card':        '#484541',
        '--bg-elevated':    '#524f4a',
        '--bg-input':       '#464440',
        '--accent':         '#c85030',
        '--accent-dim':     'rgba(200,80,48,0.14)',
        '--accent-border':  'rgba(200,80,48,0.32)',
        '--accent-glow':    'rgba(200,80,48,0.20)',
        '--accent-muted':   'rgba(200,80,48,0.55)',
        '--text-primary':   '#f5f2ee',
        '--text-secondary': '#9a9690',
        '--text-muted':     '#7a7672',
        '--border':         'rgba(0,0,0,0.18)',
        '--border-strong':  'rgba(0,0,0,0.26)',
        '--btn-bg':         '#c85030',
        '--btn-text':       '#f5f2ee',
        '--title-weight':   '700',
        '--title-style':    'normal',
        '--title-transform':'uppercase',
        '--slider-track':   '#524f4a',
        '--guided-accent':     '#c8a030',
        '--guided-accent-rgb': '200, 160, 48',
        '--radius-lg':      '4px',
        '--radius':         '4px',
        '--radius-sm':      '4px',
      },
      swatch: { bg: '#3e3c38', accent: '#c85030' },
    },
    E: {
      name: 'Miami beach sunset',
      vars: {
        '--bg':             '#0a0818',
        '--bg-card':        '#120820',
        '--bg-elevated':    '#1e1030',
        '--bg-input':       '#100618',
        '--accent':         '#e84060',
        '--accent-dim':     'rgba(232,64,96,0.12)',
        '--accent-border':  'rgba(232,64,96,0.28)',
        '--accent-glow':    'rgba(232,64,96,0.18)',
        '--accent-muted':   'rgba(232,64,96,0.55)',
        '--text-primary':   '#ffd080',
        '--text-secondary': '#c09060',
        '--text-muted':     '#806080',
        '--border':         'rgba(255,255,255,0.06)',
        '--border-strong':  'rgba(255,255,255,0.10)',
        '--btn-bg':         'linear-gradient(135deg,#e84060,#c02840)',
        '--btn-text':       '#ffd080',
        '--title-weight':   '400',
        '--title-style':    'italic',
        '--title-transform':'none',
        '--slider-track':   'linear-gradient(90deg,#4080e8,#e84060,#ffd080)',
        '--guided-accent':     '#40c8e8',
        '--guided-accent-rgb': '64, 200, 232',
        '--radius-lg':      '24px',
        '--radius':         '20px',
        '--radius-sm':      '14px',
      },
      swatch: { bg: '#0a0818', accent: '#e84060' },
    },
  };

  let activeThemeId = 'A';

  function applyTheme(id) {
    const theme = THEMES[id];
    if (!theme) return;
    const root = document.documentElement;
    Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));
    activeThemeId = id;
    localStorage.setItem('parla_theme', id);
    renderThemeList();
  }

  function openThemePicker() {
    renderThemeList();
    document.getElementById('theme-overlay').classList.add('open');
  }

  function closeThemePicker() {
    document.getElementById('theme-overlay').classList.remove('open');
  }

  function onThemeOverlayClick(e) {
    if (e.target === document.getElementById('theme-overlay')) closeThemePicker();
  }

  function renderThemeList() {
    const list = document.getElementById('theme-list');
    list.innerHTML = '';
    Object.entries(THEMES).forEach(([id, theme]) => {
      const row = document.createElement('div');
      row.className = 'theme-row' + (id === activeThemeId ? ' active' : '');
      row.innerHTML = `
        <div class="theme-swatch" style="background:${theme.swatch.bg};border-color:${id === activeThemeId ? theme.swatch.accent : 'transparent'}">
          <div class="theme-swatch-inner" style="background:${theme.swatch.accent}"></div>
        </div>
        <span class="theme-row-name">${theme.name}</span>
        <svg class="theme-check" viewBox="0 0 24 24" fill="none" stroke="${theme.swatch.accent}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>`;
      row.onclick = () => { applyTheme(id); closeThemePicker(); };
      list.appendChild(row);
    });
  }

  /* ================================ */
  /* INIT                             */
  /* ================================ */
  (function init() {
    // Skip DOM-dependent setup when loaded in test context
    if (typeof window !== 'undefined' && window.__PARLA_TEST__) return;

    // Apply saved theme immediately to avoid flash
    const savedTheme = localStorage.getItem('parla_theme') || 'A';
    applyTheme(savedTheme);

    document.getElementById('app-version').textContent = 'v' + APP_VERSION;

    restore();
    nav('home-screen');

    // seed demo vocab if none saved
    if (!localStorage.getItem('vocabulary_notebook')) {
      localStorage.setItem('vocabulary_notebook', JSON.stringify(DEMO_WORDS));
    }
  })();
