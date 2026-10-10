/* Dependency-free embed. See README.md for the backend and aligned-layer contracts. */
(() => {
  if (customElements.get('proofchain-chat')) return;
  const scriptBase = new URL('.', document.currentScript?.src || location.href);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  class ProofchainChat extends HTMLElement {
    static get observedAttributes() { return ['robot-src', 'head-src', 'body-src', 'eyes-src', 'blink-src', 'size', 'placement', 'accent', 'greeting', 'assistant-name', 'endpoint', 'z-index', 'offset-x', 'offset-y', 'animated']; }
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.messages = []; this.pose = { x: 0, y: 0 }; this.target = { x: 0, y: 0 };
      this.shadowRoot.innerHTML = `
        <style>
          :host{position:fixed;bottom:max(18px,env(safe-area-inset-bottom));left:max(18px,env(safe-area-inset-left));right:auto;z-index:var(--stack,1000);font:14px/1.5 system-ui,sans-serif;color:#142b38;color-scheme:light;--accent:#28dce8;--size:104px}
          :host([placement="right"]){left:auto;right:max(18px,env(safe-area-inset-right))}
          *,*::before,*::after{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible{outline:3px solid #087b8c;outline-offset:4px}
          .launcher{display:block;width:var(--size);height:calc(var(--size)*1.05);padding:0;border:0;background:transparent;border-radius:35%;position:relative;touch-action:manipulation}
          .lift{width:100%;height:100%;transition:transform .25s,filter .25s}.launcher:hover .lift{transform:translateY(-4px);filter:brightness(1.08) drop-shadow(0 0 7px var(--accent))}
          .float{height:100%;animation:float 5s ease-in-out infinite}.pose{position:relative;width:100%;height:100%;transform-origin:50% 65%;will-change:transform}
          .robot,.layer{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none}.head{transform-origin:50% 55%;will-change:transform}.eye-track{position:absolute;inset:0;transform-origin:50% 55%}.eyes{will-change:transform}.blink{opacity:0}.layered .robot{display:none}.pose:not(.layered) .layer,.pose:not(.layered) .eye-track{display:none}.layer:not([src]){display:none}
          .ask{display:block;position:absolute;left:50%;bottom:-18px;transform:translateX(-50%);border-radius:20px;background:#effcff;color:#376775;padding:3px 10px;font-size:10px;letter-spacing:.1em;white-space:nowrap}.badge{position:absolute;right:0;bottom:2px;width:13px;height:13px;background:var(--accent);border:3px solid white;border-radius:50%;box-shadow:0 2px 8px #142b3830}
          .panel{position:absolute;bottom:calc(100% + 14px);right:0;width:min(370px,calc(100vw - 36px - env(safe-area-inset-left) - env(safe-area-inset-right)));height:min(510px,calc(var(--view-height,100dvh) - var(--size) - 64px - env(safe-area-inset-bottom) - env(safe-area-inset-top)));min-height:180px;background:#fff;border:1px solid #d9e8eb;border-radius:22px;box-shadow:0 20px 70px #102e3a30;display:flex;flex-direction:column;overflow:hidden;animation:open .2s ease-out}
          .panel{right:auto;left:0}:host([placement="right"]) .panel{right:0;left:auto}.panel[hidden]{display:none}
          header{padding:16px 18px;display:flex;align-items:center;gap:12px;background:linear-gradient(120deg,#f1fcfd,#fff);border-bottom:1px solid #e6eef0}.avatar{width:34px;height:40px;object-fit:contain}h2{font-size:15px;margin:0}header p{margin:2px 0 0;font-size:11px;color:#536e79}.title{flex:1}.close{border:0;background:#eaf3f5;color:#244552;border-radius:50%;width:32px;height:32px;font-size:22px}
          .history{flex:1;overflow:auto;padding:18px;overscroll-behavior:contain}.message{margin:0 0 12px;padding:11px 13px;border-radius:14px;background:#f0f5f6;white-space:pre-wrap;overflow-wrap:anywhere}.message.user{margin-left:26px;background:#dff8fa}.message.assistant{margin-right:18px}.speaker{display:block;font-size:10px;font-weight:700;margin-bottom:4px;color:#44606c}
          .status{padding:0 18px 10px;font-size:12px;color:#526b76}.status:empty{display:none}.error{color:#a22b35}.retry{margin-left:8px;border:1px solid #b6cbd0;border-radius:8px;background:white;padding:3px 8px}
          form{display:flex;gap:8px;padding:12px;border-top:1px solid #e6eef0;background:white}input{width:0;flex:1;min-height:42px;border:1px solid #cbdde1;border-radius:12px;padding:8px 12px;color:#142b38;background:white}.send{border:0;border-radius:12px;background:var(--accent);color:#073b43;font-weight:700;padding:8px 14px}.send:disabled{opacity:.5;cursor:wait}.foot{font-size:10px;text-align:center;color:#657d87;padding:0 12px 10px}
          .microphone{display:flex;align-items:center;justify-content:center;gap:5px;border:1px solid #365569;border-radius:12px;padding:8px;color:#d9fbff;background:#183b4b;font-size:11px}.microphone svg{width:16px;height:16px;flex-shrink:0}.microphone[aria-pressed="true"]{background:#653042;border-color:#ffabb8;color:#fff}.microphone:disabled{opacity:.5;cursor:wait}
          @keyframes float{50%{transform:translateY(-5px)}}@keyframes open{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
          @media(max-width:600px){:host{--size:80px;bottom:max(12px,env(safe-area-inset-bottom));right:max(12px,env(safe-area-inset-right))}:host([placement="left"]){left:max(12px,env(safe-area-inset-left))}.panel{width:calc(100vw - 24px - env(safe-area-inset-left) - env(safe-area-inset-right));max-width:370px}}
          @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}.launcher:hover .lift{transform:none}.pose,.head,.eyes{will-change:auto}}
          .panel{background:#0c1a2d;color:#eafaff;border-color:#25485e;color-scheme:dark}header{background:#11243a;border-color:#25485e}header p,.speaker,.status,.foot{color:#b0cbd6}.close{background:#233e51;color:#fff}.message{background:#1b3048}.message.user{background:#123f50}.error{color:#ffabb8}form{background:#0c1a2d;border-color:#25485e}input{background:#152a40;color:#fff;border-color:#365569}.retry,.action{background:#183b4b;color:#d9fbff;border:1px solid var(--accent);border-radius:10px;padding:6px 10px}.action{display:block;margin-top:10px} @media print{:host{display:none}}
        </style>
        <section class="panel" role="dialog" aria-modal="false" aria-labelledby="title" hidden>
          <header><img class="avatar" alt=""><div class="title"><h2 id="title"></h2><p class="mode"></p></div><button class="close" type="button" aria-label="Close assistant">×</button></header>
          <div class="history" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions"></div>
          <div class="status" role="status" aria-live="polite"></div>
          <form><input aria-label="Message the assistant" placeholder="Ask a question…" maxlength="4000" autocomplete="off"><button class="microphone" type="button" aria-label="Start microphone" aria-pressed="false" title="Speak your message"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg><span>Microphone</span></button><button class="send" type="submit">Send</button></form>
          <div class="foot"></div>
        </section>
        <button class="launcher" type="button" aria-label="Open assistant" aria-expanded="false" aria-haspopup="dialog"><div class="lift"><div class="float"><div class="pose"><img class="robot" alt=""><img class="layer body" alt=""><img class="layer head" alt=""><div class="eye-track"><img class="layer eyes" alt=""></div><img class="layer blink" alt=""></div></div></div><span class="ask" aria-hidden="true">ASK AI</span></button>`;
      this.$ = s => this.shadowRoot.querySelector(s);
    }
    connectedCallback() {
      if (this.lifecycle) return;
      this.lifecycle = new AbortController(); const signal = this.lifecycle.signal;
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
      this.pointerMedia = matchMedia('(any-hover: hover) and (any-pointer: fine)');
      const listen = (node, event, fn, opts = {}) => node.addEventListener(event, fn, { ...opts, signal });
      listen(this.$('.launcher'), 'click', () => this.toggle());
      listen(this.$('.close'), 'click', () => this.toggle(false));
      listen(window, 'keydown', e => { if (e.key === 'Escape' && !this.$('.panel').hidden) { e.preventDefault(); this.toggle(false); } });
      listen(this.$('.microphone'), 'click', () => this.toggleDictation());
      listen(this.$('form'), 'submit', e => { e.preventDefault(); const value = this.$('input').value.trim(); if (value && !this.busy && !this.recognition) { this.$('input').value = ''; this.messages.push({ role: 'user', content: value }); this.addMessage('user', value); this.send(); } });
      listen(window, 'pointermove', e => {
        if (!this.canTrack() || e.pointerType === 'touch') return;
        this.pointer = { x: e.clientX, y: e.clientY }; this.updateTarget();
      }, { passive: true, capture: true });
      listen(document.documentElement, 'pointerleave', () => this.neutral());
      listen(window, 'blur', () => this.neutral());
      listen(document, 'visibilitychange', () => { if (document.hidden) { this.cancelDictation(); this.neutral(); cancelAnimationFrame(this.frame); this.frame = 0; this.applyPose(0, 0); } });
      listen(window, 'scroll', () => this.updateTarget(), { passive: true, capture: true });
      listen(window, 'resize', () => this.resize(), { passive: true });
      if (window.visualViewport) { listen(visualViewport, 'resize', () => this.resize()); listen(visualViewport, 'scroll', () => this.resize()); }
      const motionChange = () => { this.neutral(); if (!this.canTrack()) { cancelAnimationFrame(this.frame); this.frame = 0; this.applyPose(0, 0); } this.scheduleBlink(); };
      listen(this.reduced, 'change', motionChange); listen(this.pointerMedia, 'change', motionChange);
      this.observer = new ResizeObserver(() => this.updateTarget()); this.observer.observe(this);
      this.configure(); this.resize(); this.scheduleBlink();
    }
    disconnectedCallback() {
      this.cancelDictation();
      this.lifecycle?.abort(); this.lifecycle = null; this.request?.abort(); this.observer?.disconnect(); for (const key of ['body','head','eyes']) { this.$(`.${key}`).onload = null; this.$(`.${key}`).onerror = null; }
      cancelAnimationFrame(this.frame); this.frame = 0; clearTimeout(this.blinkTimer); clearTimeout(this.unblinkTimer); clearTimeout(this.scheduleBlinkTimer); this.blinkAnimation?.cancel();
    }
    attributeChangedCallback() { if (this.lifecycle) { this.configure(); this.resize(); this.updateTarget(); this.scheduleBlink(); } }
    configure() {
      const asset = this.getAttribute('robot-src') || new URL('robot.png', scriptBase).href;
      this.$('.robot').src = asset; this.$('.avatar').src = asset;
      this.name = this.getAttribute('assistant-name') || 'ProofChain assistant';
      this.$('h2').textContent = this.name;
      this.$('.launcher').setAttribute('aria-label', `${this.$('.panel').hidden ? 'Open' : 'Close'} ${this.name}`);
      this.$('input').setAttribute('aria-label', `Message ${this.name}`);
      const candidate = ['body', 'head', 'eyes'].every(key => this.getAttribute(`${key}-src`));
      this.layered = false;
      this.$('.pose').classList.toggle('layered', this.layered);
      for (const key of ['body', 'head', 'eyes', 'blink']) {
        const img = this.$(`.${key}`); const value = this.getAttribute(`${key}-src`);
        if (candidate && value) { if (img.getAttribute('src') !== value) img.src = value; } else img.removeAttribute('src');
      }
      for (const [attr, prop] of [['offset-x', '--offset-x'], ['offset-y', '--offset-y']]) { const n = Number(this.getAttribute(attr) || 18); this.style.setProperty(prop, `${clamp(Number.isFinite(n) ? n : 18, 0, 2000)}px`); }
      const verifyLayers = () => { const imgs = ['body', 'head', 'eyes'].map(key => this.$(`.${key}`)); this.layered = !!candidate && imgs.every(img => img.complete && img.naturalWidth > 0 && img.naturalWidth === imgs[0].naturalWidth && img.naturalHeight === imgs[0].naturalHeight); this.$('.pose').classList.toggle('layered', this.layered); this.applyPose(this.pose.x, this.pose.y); this.scheduleBlink(); };
      for (const key of ['body', 'head', 'eyes']) { this.$(`.${key}`).onload = verifyLayers; this.$(`.${key}`).onerror = verifyLayers; }
      verifyLayers();
      const size = Number(this.getAttribute('size'));
      if (size > 0) this.style.setProperty('--size', `${clamp(size, 48, 220)}px`); else this.style.removeProperty('--size');
      const accent = this.getAttribute('accent'); this.style.setProperty('--accent', accent && CSS.supports('color', accent) ? accent : '#28dce8');
      const z = Number(this.getAttribute('z-index') || 1000); this.style.setProperty('--stack', String(Number.isFinite(z) ? Math.trunc(z) : 1000));
      const demo = !this.getAttribute('endpoint');
      this.$('.mode').textContent = demo ? 'Demo mode · no AI backend connected' : 'AI assistant · responses may be inaccurate';
      this.$('.foot').textContent = demo ? 'Local sample replies. No account actions are performed.' : 'Avoid sending sensitive information.';
      if (!this.messages.length && !this.$('.history').children.length) this.addMessage('assistant', this.getAttribute('greeting') || 'Hi! I’m here to help you find your way around ProofChain. What would you like to know?');
      this.applyPose(this.pose.x, this.pose.y);
    }
    canTrack() { return this.pointerMedia.matches && !this.reduced.matches && !document.hidden; }
    resize() {
      this.style.setProperty('--view-height', `${window.visualViewport?.height || innerHeight}px`);
      // Keep the launcher above a mobile keyboard when visualViewport shrinks.
      const viewport = window.visualViewport;
      const inset = viewport ? Math.max(0, innerHeight - viewport.height - viewport.offsetTop) : 0;
      const x = this.style.getPropertyValue('--offset-x') || '18px';
      this.style.left = this.getAttribute('placement') === 'right' ? 'auto' : `max(${x},env(safe-area-inset-left))`;
      this.style.right = this.getAttribute('placement') === 'right' ? `max(${x},env(safe-area-inset-right))` : 'auto';
      this.style.bottom = `max(${inset + Number(this.getAttribute('offset-y') || 36)}px,env(safe-area-inset-bottom))`;
      const panel = this.$('.panel');
      const rect = this.$('.launcher').getBoundingClientRect();
      const top = viewport?.offsetTop || 0, height = viewport?.height || innerHeight;
      const above = rect.top - top - 26, below = top + height - rect.bottom - 26;
      const useBelow = above < 180 && below > above;
      const panelHeight = Math.min(510, height - 24, Math.max(180, useBelow ? below : above));
      const panelWidth = Math.min(370, (viewport?.width || innerWidth) - 24);
      panel.style.position = 'fixed'; panel.style.width = `${panelWidth}px`; panel.style.height = `${panelHeight}px`; panel.style.bottom = 'auto'; panel.style.right = 'auto';
      panel.style.left = `${clamp(rect.left, 12, innerWidth - panelWidth - 12)}px`;
      panel.style.top = `${clamp(useBelow ? rect.bottom + 14 : rect.top - panelHeight - 14, top + 12, top + height - panelHeight - 12)}px`;
      this.updateTarget();
    }
    updateTarget() {
      if (!this.pointer || !this.canTrack()) return;
      const r = this.$('.launcher').getBoundingClientRect();
      // A smaller tracking radius makes nearby mouse movements easy to see.
      this.target = { x: Math.tanh((this.pointer.x - r.left - r.width / 2) / clamp(innerWidth * .2, 120, 260)), y: Math.tanh((this.pointer.y - r.top - r.height / 2) / clamp(innerHeight * .2, 100, 200)) };
      this.animate();
    }
    neutral() { this.pointer = null; this.target = { x: 0, y: 0 }; if (!this.reduced?.matches) this.animate(); }
    animate() {
      if (this.frame || !this.isConnected || this.reduced?.matches || document.hidden) return;
      this.lastTime = 0;
      const tick = time => {
        const factor = 1 - Math.exp(-Math.min(this.lastTime ? time - this.lastTime : 16, 64) / 55); this.lastTime = time;
        const x = this.pose.x + (this.target.x - this.pose.x) * factor;
        const y = this.pose.y + (this.target.y - this.pose.y) * factor;
        this.applyPose(x, y);
        if (Math.abs(x - this.target.x) + Math.abs(y - this.target.y) > .001) this.frame = requestAnimationFrame(tick); else this.frame = 0;
      };
      this.frame = requestAnimationFrame(tick);
    }
    applyPose(x, y) {
      this.pose = { x, y };
      const rotate = `perspective(450px) rotateX(${-y * 18}deg) rotateY(${x * 24}deg) rotateZ(${x * 10}deg)`;
      const r = this.$('.launcher').getBoundingClientRect();
      const shiftX = clamp(x * 16, Math.min(0, 12 - r.left), Math.max(0, innerWidth - r.right - 12));
      const shiftY = clamp(y * 12, Math.min(0, 12 - r.top), Math.max(0, innerHeight - r.bottom - 12));
      this.$('.pose').style.transform = `translate(${shiftX}px,${shiftY}px)${this.layered ? '' : ` ${rotate}`}`;
      this.$('.head').style.transform = this.layered ? rotate : '';
      this.$('.eye-track').style.transform = this.layered ? rotate : '';
      const eyes = `translate(${x * 10}px,${y * 8}px)`;
      this.$('.eyes').style.transformOrigin = '50% 32%';
      this.$('.eyes').style.transform = this.layered ? eyes : ''; this.$('.blink').style.transform = this.layered ? eyes : '';
    }
    scheduleBlink() {
      clearTimeout(this.blinkTimer); clearTimeout(this.scheduleBlinkTimer); this.blinkAnimation?.cancel(); this.blinkScale = 1;
      this.applyPose(this.pose.x, this.pose.y);
      if (!this.layered || this.reduced.matches || !this.isConnected) return;
      this.blinkTimer = setTimeout(() => {
        if (!document.hidden) {
          const eye = this.$('.eyes');
          // Individual scale composes with tracking transforms rather than replacing them.
          this.blinkAnimation = eye.animate([{scale:'1 1'}, {scale:'1 .03',offset:.5}, {scale:'1 1'}], {duration:200});
        }
        this.scheduleBlinkTimer = setTimeout(() => this.scheduleBlink(), 210);
      }, 3500 + Math.random() * 3500);
    }
    toggle(open = this.$('.panel').hidden) {
      if (!open) this.cancelDictation();
      this.$('.panel').hidden = !open;
      this.$('.launcher').setAttribute('aria-expanded', String(open));
      this.$('.launcher').setAttribute('aria-label', `${open ? 'Close' : 'Open'} ${this.name}`);
      this.resize();
      if (open) this.$('input').focus({ preventScroll: true }); else this.$('.launcher').focus({ preventScroll: true });
    }
    addMessage(role, content) {
      const row = document.createElement('div'); row.className = `message ${role}`;
      const label = document.createElement('span'); label.className = 'speaker'; label.textContent = role === 'user' ? 'You' : this.name;
      const text = document.createElement('span'); text.textContent = content; row.append(label, text); this.$('.history').append(row);
      this.scrollHistory(); return { row, text };
    }
    scrollHistory() { this.$('.history').scrollTop = this.$('.history').scrollHeight; }
    status(text, error = false) { this.$('.status').textContent = text; this.$('.status').classList.toggle('error', error); }
    updateDictationControls() {
      const active = !!this.recognition;
      const button = this.$('.microphone');
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-label', active ? 'Stop microphone' : 'Start microphone');
      button.title = active ? 'Stop listening and review your message' : 'Speak your message';
      button.querySelector('span').textContent = active ? 'Stop' : 'Microphone';
      button.disabled = !!this.busy || !!this.dictationStopping;
      this.$('input').readOnly = !!this.busy || active;
      this.$('.send').disabled = !!this.busy || active;
    }
    cancelDictation() {
      const recognition = this.recognition;
      this.recognition = null; this.dictationStopping = false;
      clearTimeout(this.dictationTimer); clearTimeout(this.dictationStopTimer);
      if (recognition) {
        recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null;
        try { recognition.abort(); } catch {}
        if (!this.busy) this.status('Microphone stopped. You can edit your message and send it.');
      }
      this.updateDictationControls();
    }
    toggleDictation() {
      if (this.busy || this.dictationStopping) return;
      if (this.recognition) {
        this.dictationStopping = true; this.updateDictationControls();
        this.status('Finishing transcription…');
        try {
          this.recognition.stop();
          if (this.recognition) this.dictationStopTimer = setTimeout(() => this.cancelDictation(), 3000);
        } catch { this.cancelDictation(); }
        return;
      }
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) { this.status('Voice input is unavailable in this browser. Try a browser with speech recognition, or type your message.', true); return; }
      if (!window.isSecureContext) { this.status('Microphone access needs a secure HTTPS connection. You can still type your message.', true); return; }
      const input = this.$('input');
      const base = input.value.trimEnd();
      if (base.length >= input.maxLength) { this.status('Your message is full. Edit or send it before recording more.', true); return; }
      let recognition;
      try { recognition = new SpeechRecognition(); } catch { this.status('Could not start voice input. You can still type your message.', true); return; }
      this.recognition = recognition;
      recognition.lang = this.lang || document.documentElement.lang || navigator.language || 'en-NG';
      recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 1;
      let heard = false, failed = false, truncated = false;
      const current = () => this.recognition === recognition && this.isConnected;
      recognition.onstart = () => { if (current()) this.status('Listening… Speak your message, then tap Stop.'); };
      recognition.onresult = event => {
        if (!current()) return;
        // Rebuild this session's result list so interim revisions never duplicate words.
        const transcript = Array.from(event.results, result => result[0]?.transcript || '').join(' ').trim();
        heard = !!transcript;
        const combined = [base, transcript].filter(Boolean).join(' ');
        input.value = combined.slice(0, input.maxLength);
        if (combined.length >= input.maxLength) { truncated = true; this.toggleDictation(); }
      };
      recognition.onerror = event => {
        if (!current()) return;
        failed = true;
        const errors = {
          'not-allowed': 'Microphone permission was denied. Allow microphone access in your browser and try again.',
          'service-not-allowed': 'Speech recognition is disabled in this browser. You can still type your message.',
          'audio-capture': 'No microphone is available. Connect a microphone and try again.',
          'no-speech': 'No speech was detected. Tap Microphone and try speaking again.',
          'network': 'Speech recognition could not connect. Check your connection and try again.',
          'language-not-supported': 'Speech recognition does not support this language in your browser.',
        };
        this.cancelDictation();
        this.status(errors[event.error] || 'Voice input stopped. You can edit the transcription or try again.', true);
      };
      recognition.onend = () => {
        if (!current()) return;
        this.recognition = null; this.dictationStopping = false;
        clearTimeout(this.dictationTimer); clearTimeout(this.dictationStopTimer);
        this.updateDictationControls();
        if (!failed) this.status(truncated ? 'Message limit reached. Review your transcription and tap Send.' : heard ? 'Transcribed. Review your message and tap Send.' : 'No speech was detected. Tap Microphone to try again.');
      };
      this.updateDictationControls(); this.status('Starting microphone…');
      try {
        recognition.start();
        if (this.recognition) this.dictationTimer = setTimeout(() => { if (current() && !this.dictationStopping) this.toggleDictation(); }, 60000);
      } catch { this.cancelDictation(); this.status('Could not start the microphone. Check microphone access and try again.', true); }
    }
    requestHistory() { let length = 0; const recent = []; for (const message of [...this.messages].reverse()) { if (recent.length >= 30 || length + message.content.length > 24000) break; recent.unshift(message); length += message.content.length; } return recent; }
    async send() {
      if (this.busy || !this.isConnected) return;
      this.cancelDictation(); this.busy = true; this.updateDictationControls(); this.$('input').focus({ preventScroll: true }); this.$('.history').setAttribute('aria-busy', 'true'); this.status('Preparing a reply…');
      this.pendingActions = []; this.request = new AbortController(); let output = null; let result = '';
      const append = delta => { if (typeof delta !== 'string') throw new Error('Invalid response text.'); if (!delta) return; if (!output) output = this.addMessage('assistant', ''); result += delta; output.text.textContent = result; this.scrollHistory(); };
      try {
        const endpoint = this.getAttribute('endpoint');
        if (!endpoint) {
          const question = this.messages.at(-1).content.toLowerCase();
          append(question.includes('wallet') || question.includes('credit') ? 'Demo reply: Your wallet shows waste credits and transaction history. Hub re-weighs may adjust credits. This sample cannot read your balance or perform a withdrawal.' : question.includes('pickup') || question.includes('request') ? 'Demo reply: Open “Request pickup” in your requester account, choose a hub and material, then enter the collection details. This sample has not booked a pickup.' : 'Demo reply: ProofChain connects waste collection, hub re-weighs, rewards, and audit records. Try asking about pickups or your wallet. Connect an AI backend for live answers.');
        } else {
          const response = await (this.requestAssistant || fetch)(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream, text/plain' }, credentials: 'same-origin', body: JSON.stringify({ messages: this.requestHistory() }), signal: this.request.signal });
          if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to use the assistant.' : response.status === 429 ? 'Too many requests. Please wait a minute.' : 'The assistant service is unavailable. Please retry.');
          const type = response.headers.get('content-type') || '';
          if (type.includes('application/json')) { const data = await response.json(); append(data.message); }
          else if (type.includes('text/event-stream')) {
            await this.readStream(response, append, true);
          } else if (type.includes('text/plain')) await this.readStream(response, append, false);
          else throw new Error('Unsupported response format. Expected JSON, text, or SSE.');
        }
        if (!result.trim()) throw new Error('The assistant returned an empty response.');
        for (const button of this.pendingActions) button.disabled = false;
        this.messages.push({ role: 'assistant', content: result }); this.status('');
      } catch (error) {
        output?.row.remove(); for (const button of this.pendingActions) button.remove();
        if (this.isConnected && error.name !== 'AbortError') {
          this.status(`${error.message || 'Could not reach the assistant.'} Your message is saved.`, true);
          const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'retry'; retry.textContent = 'Retry'; retry.addEventListener('click', () => this.send(), { signal: this.lifecycle.signal }); this.$('.status').append(retry);
        }
      } finally {
        this.busy = false; this.updateDictationControls(); this.$('.history').setAttribute('aria-busy', 'false');
      }
    }
    addAction(action, label) {
      const allowed = ['dashboard', 'wallet', 'history', 'rewards', 'request'];
      const a = action;
      const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
      const amount = (v, max=1000000) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max && Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-7;
      const keys = (...names) => a && typeof a === 'object' && !Array.isArray(a) && Object.keys(a).every(k=>names.includes(k));
      const valid = a && (
        a.kind === 'navigate' && keys('kind','target') && allowed.includes(a.target) ||
        a.kind === 'review-withdrawal' && keys('kind','amountCredits') && amount(a.amountCredits) ||
        a.kind === 'review-reward' && keys('kind','itemId') && uuid(a.itemId) ||
        a.kind === 'review-claim' && keys('kind','code') && typeof a.code === 'string' && /^(?:[A-HJ-NP-Z2-9]{8}|[A-HJ-NP-Z2-9]{10})$/.test(a.code) ||
        a.kind === 'set-theme' && keys('kind','theme') && ['light','dark'].includes(a.theme) ||
        a.kind === 'review-pickup' && keys('kind','hubId','material','estimatedWeightKg','address','notes') && uuid(a.hubId) && typeof a.material === 'string' && /^[A-Z0-9_-]{2,16}$/.test(a.material) && amount(a.estimatedWeightKg,100000) && typeof a.address === 'string' && !!a.address.trim() && a.address.length <= 500 && (a.notes === undefined || typeof a.notes === 'string' && a.notes.length <= 1000));
      if (!valid || typeof label !== 'string' || label.length > 200) throw new Error('Unsupported application action.');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'action'; button.textContent = label; button.disabled = true;
      this.pendingActions.push(button); this.$('.history').append(button);
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { if (!this.performAction) throw new Error('This website has not connected application actions.'); const status = await this.performAction(Object.freeze({...action})); if (typeof status !== 'string') throw new Error('The application did not confirm this action.'); if (this.isConnected) this.status(status); }
        catch (error) { if (this.isConnected) this.status(error.message || 'Could not open the application screen.', true); }
        finally { button.disabled = false; }
      }, {signal: this.lifecycle.signal});
    }
    async readStream(response, append, sse) {
      if (!response.body) throw new Error('Streaming is unavailable.');
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let completed = false;
      const consume = block => {
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) return; if (data === '[DONE]') { completed = true; return; }
        const event = JSON.parse(data);
        if (event.action) { this.addAction(event.action, event.label); }
        else if (event.error) throw new Error(event.error);
        else if (typeof event.delta === 'string') append(event.delta);
        else if (typeof event.activity === 'string') this.status(event.activity);
        else if (event.type === 'activity') { if (typeof event.label === 'string') this.status(event.label); }
        else if (event.type === 'error') throw new Error(event.message || 'Assistant stream failed.');
        else if (event.type === 'delta') append(event.text);
        else if (event.type === 'done') completed = true;
        else throw new Error('Unknown assistant stream event.');
      };
      try {
        while (true) {
          const { value, done } = await reader.read(); const chunk = decoder.decode(value, { stream: !done });
          if (sse) {
            buffer += chunk; buffer = buffer.replace(/\r\n/g, '\n'); let index;
            while ((index = buffer.indexOf('\n\n')) !== -1) { consume(buffer.slice(0, index)); buffer = buffer.slice(index + 2); }
            if (buffer.length > 1048576) throw new Error('Assistant stream event is too large.');
          } else append(chunk);
          if (done) { if (sse && buffer.trim()) consume(buffer); if (sse && !completed) throw new Error('The response was interrupted. Please retry.'); break; }
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
  }
  customElements.define('proofchain-chat', ProofchainChat);
  if (!customElements.get('robot-chat')) customElements.define('robot-chat', class extends ProofchainChat {});
})();
