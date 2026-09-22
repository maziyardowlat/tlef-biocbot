(function () {
    'use strict';

    var page = document.getElementById('bb-page');
    if (!page) return;

    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ── Hero mode toggle + line cycling ────────────────────────────────
    var LINES = {
        tutor: [
            "Before we get to the rate law, what does PFK-1 do to fructose-6-phosphate?",
            "Good. So which step of glycolysis is the committed one, and why that one?",
            "Let's look at your notes from Monday. Where did the ATP count come from?"
        ],
        protege: [
            "Hi, I'm BiocBot. Teach me this unit?",
            "Wait, you said high ATP slows glycolysis. Isn't ATP what the cell wants?",
            "So is that second site the same place the sugar binds, or somewhere else?"
        ]
    };
    var MODE_NOTES = {
        tutor: "Tutor mode: BiocBot asks the questions and walks you through the unit.",
        protege: "Protégé mode: BiocBot plays the student and you do the explaining."
    };

    var botLineEl = document.getElementById('bb-bot-line');
    var modeNoteEl = document.getElementById('bb-mode-note');
    var modeBtns = Array.prototype.slice.call(page.querySelectorAll('[data-mode-btn]'));
    var mode = 'tutor';
    var lineIndex = 0;
    var cycleTimer = null;

    function renderLine() {
        if (botLineEl) botLineEl.textContent = LINES[mode][lineIndex];
        if (modeNoteEl) modeNoteEl.textContent = MODE_NOTES[mode];
    }

    function startCycle() {
        clearInterval(cycleTimer);
        cycleTimer = setInterval(function () {
            lineIndex = (lineIndex + 1) % 3;
            renderLine();
        }, 6000);
    }

    function setMode(next) {
        if (next === mode) return;
        mode = next;
        lineIndex = 0;
        modeBtns.forEach(function (btn) {
            btn.setAttribute('aria-pressed', String(btn.dataset.modeBtn === mode));
        });
        renderLine();
        startCycle();
    }

    modeBtns.forEach(function (btn) {
        btn.addEventListener('click', function () { setMode(btn.dataset.modeBtn); });
    });

    if (botLineEl) {
        renderLine();
        startCycle();
    }

    // Flip cards flip on hover/focus via CSS alone (see .bb-flip-card:hover
    // / :focus-within in homepage.css) — no click state to manage here.

    // ── Active nav highlighting ─────────────────────────────────────────
    var navLinks = Array.prototype.slice.call(page.querySelectorAll('[data-navlink]'));
    if (navLinks.length && 'IntersectionObserver' in window) {
        var navSections = navLinks
            .map(function (a) { return { a: a, sec: document.getElementById(a.dataset.navlink) }; })
            .filter(function (p) { return p.sec; });

        var navObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                var pair = navSections.find(function (p) { return p.sec === entry.target; });
                if (!pair) return;
                pair.a.toggleAttribute('aria-current', entry.isIntersecting);
            });
        }, { rootMargin: '-140px 0px -60% 0px', threshold: 0 });

        navSections.forEach(function (p) { navObserver.observe(p.sec); });
    }

    // ── Scroll reveal ───────────────────────────────────────────────────
    if (!reducedMotion && 'IntersectionObserver' in window) {
        var revealObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('bb-revealed');
                revealObserver.unobserve(entry.target);
            });
        }, { threshold: 0, rootMargin: '0px 0px -10% 0px' });

        page.querySelectorAll('.bb-reveal').forEach(function (el) { revealObserver.observe(el); });
    } else {
        page.querySelectorAll('.bb-reveal').forEach(function (el) { el.classList.add('bb-revealed'); });
    }
})();
