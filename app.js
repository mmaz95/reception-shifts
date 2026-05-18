'use strict';

// ================================================================
// COSTANTI
// ================================================================

const GIORNI = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
const GIORNI_BREVI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

const TURNI = {
  MATTINA: {
    label: 'Mattina',
    start: 420,   // 07:00
    end: 870,     // 14:30
    duration: 450,
    cssClass: 'badge-MATTINA',
    fixed: true
  },
  POMERIGGIO: {
    label: 'Pomeriggio',
    start: 870,   // 14:30
    end: 1320,    // 22:00
    duration: 450,
    cssClass: 'badge-POMERIGGIO',
    fixed: true
  },
  CAVALLO: {
    label: 'A cavallo',
    duration: 450,
    cssClass: 'badge-CAVALLO',
    fixed: false
  },
  RIDOTTO: {
    label: 'Ridotto',
    duration: 300,
    cssClass: 'badge-RIDOTTO',
    fixed: false
  },
  RIPOSO: {
    label: 'Riposo',
    duration: 0,
    cssClass: 'badge-RIPOSO',
    fixed: false
  }
};

// Colori timeline (per canvas/div)
const TIMELINE_COLORS = {
  MATTINA:    { bg: '#B3E5FC', text: '#01579B' },
  POMERIGGIO: { bg: '#FFE0B2', text: '#BF360C' },
  CAVALLO:    { bg: '#E1BEE7', text: '#4A148C' },
  RIDOTTO:    { bg: '#FFF9C4', text: '#F57F17' },
  RIPOSO:     { bg: '#ECEFF1', text: '#607D8B' }
};

const STORAGE = {
  receptionists: 'turni_receptionists',
  weeks: 'turni_weeks',
  currentWeek: 'turni_current_week'
};

const DEFAULT_RECEPTIONISTS = [
  { id: 'r1', name: 'Alice',  color: '#E91E63', active: true },
  { id: 'r2', name: 'Bob',    color: '#2196F3', active: true },
  { id: 'r3', name: 'Carlo',  color: '#4CAF50', active: true }
];

// ================================================================
// UTILITÀ
// ================================================================

/** Converte minuti → stringa HH:MM */
function minToTime(min) {
  if (min === null || min === undefined) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Converte stringa HH:MM → minuti dalla mezzanotte */
function timeToMin(str) {
  if (!str) return null;
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}

/** Intero casuale in [min, max] inclusi */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Copia e mescola un array */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** ID univoco semplice */
function genId() {
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

/** Data formattata gg/mm */
function fmtDate(date) {
  return date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
}

/**
 * Calcola la chiave ISO della settimana per una data.
 * Formato: "YYYY-Www"
 */
function weekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Ritorna il lunedì della settimana identificata da una weekKey.
 */
function weekStart(key) {
  const [yearStr, wStr] = key.split('-W');
  const year = parseInt(yearStr, 10);
  const week = parseInt(wStr, 10);
  // 4 gennaio è sempre nella settimana 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4day + 1 + (week - 1) * 7);
  return monday;
}

function nextWeekKey(key) {
  const d = weekStart(key);
  d.setUTCDate(d.getUTCDate() + 7);
  return weekKey(d);
}

function prevWeekKey(key) {
  const d = weekStart(key);
  d.setUTCDate(d.getUTCDate() - 7);
  return weekKey(d);
}

/** Clona profondo un oggetto semplice */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ================================================================
// STATE — gestione dati e Firebase Realtime Database
// ================================================================

const State = {
  receptionists: [],
  weeks: {},
  currentWeek: null,

  async load() {
    await this._migrateFromLocalStorage();
    const snap = await window.db.ref('/').once('value');
    const data = snap.val() || {};
    this.receptionists = data.receptionists || deepClone(DEFAULT_RECEPTIONISTS);
    this.weeks         = data.weeks         || {};
    this.currentWeek   = data.currentWeek   || weekKey(new Date());
    this._setupRealtimeListeners();
  },

  _setupRealtimeListeners() {
    window.db.ref('/').on('value', snap => {
      const data = snap.val() || {};
      this.receptionists = data.receptionists || deepClone(DEFAULT_RECEPTIONISTS);
      this.weeks         = data.weeks         || {};
      this.currentWeek   = data.currentWeek   || weekKey(new Date());
      if (UI.currentView) UI._renderView(UI.currentView);
    });
  },

  async _migrateFromLocalStorage() {
    const fbSnap = await window.db.ref('/').once('value');
    if (fbSnap.exists()) return;
    const lsR  = localStorage.getItem(STORAGE.receptionists);
    const lsW  = localStorage.getItem(STORAGE.weeks);
    const lsCW = localStorage.getItem(STORAGE.currentWeek);
    if (!lsR && !lsW) return;
    const migrateData = {};
    if (lsR)  migrateData.receptionists = JSON.parse(lsR);
    if (lsW)  migrateData.weeks         = JSON.parse(lsW);
    if (lsCW) migrateData.currentWeek   = lsCW;
    await window.db.ref('/').set(migrateData);
  },

  save() {
    window.db.ref('/').set({
      receptionists: this.receptionists,
      weeks: this.weeks,
      currentWeek: this.currentWeek
    }).catch(err => console.error('[Firebase] Errore salvataggio:', err));
  },

  async reset() {
    await window.db.ref('/').remove();
    this.receptionists = deepClone(DEFAULT_RECEPTIONISTS);
    this.weeks = {};
    this.currentWeek = weekKey(new Date());
    this.save();
  },

  async resetWeeks() {
    await window.db.ref('/weeks').remove();
    this.weeks = {};
  },

  activeReceptionists() {
    return this.receptionists.filter(r => r.active);
  },

  findById(id) {
    return this.receptionists.find(r => r.id === id) || null;
  },

  addReceptionist(name, color) {
    const r = { id: genId(), name: name.trim(), color, active: true };
    this.receptionists.push(r);
    this.save();
    return r;
  },

  updateReceptionist(id, changes) {
    const r = this.findById(id);
    if (r) { Object.assign(r, changes); this.save(); }
  },

  deactivateReceptionist(id) {
    if (this.activeReceptionists().length <= 3) return false;
    const r = this.findById(id);
    if (r) { r.active = false; this.save(); }
    return true;
  },

  currentSchedule() {
    return this.weeks[this.currentWeek] || null;
  },

  saveSchedule(key, schedule) {
    this.weeks[key] = schedule;
    this.save();
  }
};

// ================================================================
// ENGINE — motore di pianificazione
// ================================================================

const Engine = {

  /** Genera un orario CAVALLO casuale valido (cross 14:30, entro 07:01–22:00) */
  genCavallo(startMin) {
    // start in [421, 869] minuti (07:01 – 14:29), end = start + 450 ≤ 1320
    const s = (startMin !== undefined) ? startMin : randInt(421, 869);
    return { start: Math.min(Math.max(s, 421), 869), end: Math.min(Math.max(s, 421), 869) + 450 };
  },

  /** Genera un orario RIDOTTO casuale valido (5h nella fascia 07:00–22:00) */
  genRidotto() {
    // start in [420, 1020], end = start + 300 ≤ 1320
    const s = randInt(420, 1020);
    return { start: s, end: s + 300 };
  },

  /**
   * Calcola i buchi di copertura in [420, 1320] (07:00–22:00)
   * per una lista di slot { type, start, end }.
   * Ritorna array di { start, end } per ogni buco.
   */
  computeGaps(slots) {
    // Array "coperto[i]" = minuto (420+i) è coperto
    const LEN = 900;
    const covered = new Uint8Array(LEN);
    for (const s of slots) {
      if (!s || s.type === 'RIPOSO') continue;
      const from = Math.max(s.start, 420) - 420;
      const to   = Math.min(s.end, 1320) - 420;
      for (let i = from; i < to; i++) covered[i] = 1;
    }
    const gaps = [];
    let gStart = -1;
    for (let i = 0; i < LEN; i++) {
      if (!covered[i] && gStart === -1) gStart = i;
      if (covered[i] && gStart !== -1) {
        gaps.push({ start: gStart + 420, end: i + 420 });
        gStart = -1;
      }
    }
    if (gStart !== -1) gaps.push({ start: gStart + 420, end: 1320 });
    return gaps;
  },

  isCovered(slots) {
    return this.computeGaps(slots).length === 0;
  },

  /**
   * Genera la pianificazione settimanale.
   * Ritorna l'oggetto schedule o null se i vincoli sono impossibili.
   *
   * constraints = {
   *   restDays?:    { [rId]: dayIndex }          // 0=Lun … 6=Dom
   *   reducedDays?: { [rId]: dayIndex[] }        // 1 o 2 giorni
   *   cavalloRId?:  string
   *   cavalloDay?:  number
   *   cavalloStart?: number                       // minuti
   * }
   */
  generate(receptionists, constraints = {}) {
    const MAX = 600;
    for (let attempt = 0; attempt < MAX; attempt++) {
      const result = this._attempt(receptionists, constraints);
      if (result !== null) return result;
    }
    return null;
  },

  _attempt(receptionists, constraints) {
    const ids = receptionists.map(r => r.id);
    const n = ids.length;

    // ── Passo 1: assegna giorni di riposo (nessuna sovrapposizione) ──
    const restDay = {}; // rId → dayIndex
    const usedRest = new Set();

    // Prima applica i vincoli forzati
    for (const rid of ids) {
      const forced = constraints.restDays?.[rid];
      if (forced !== undefined && forced !== null && forced !== '') {
        const d = parseInt(forced, 10);
        if (usedRest.has(d)) return null; // conflitto
        restDay[rid] = d;
        usedRest.add(d);
      }
    }

    // Poi assegna randomicamente quelli liberi
    const freeIds = shuffle(ids.filter(id => !(id in restDay)));
    const freeDays = shuffle([0,1,2,3,4,5,6].filter(d => !usedRest.has(d)));
    if (freeIds.length > freeDays.length) return null;
    for (let i = 0; i < freeIds.length; i++) {
      restDay[freeIds[i]] = freeDays[i];
      usedRest.add(freeDays[i]);
    }

    // ── Passo 2: assegna giorni ridotti (2 per persona, tra i giorni lavorativi) ──
    const reducedDays = {}; // rId → Set<dayIndex>
    // Contatore ridotti per giorno: serve per distribuirli uniformemente
    const reducedCount = Array(7).fill(0);

    for (const rid of shuffle([...ids])) {
      const workDays = [0,1,2,3,4,5,6].filter(d => d !== restDay[rid]);
      const forced = constraints.reducedDays?.[rid];

      // Giorni "forzati full": giorni in cui un altro receptionist è in riposo.
      // In quei giorni ci sono solo 2 lavoratori, quindi rid deve essere a turno pieno
      // per garantire almeno 2 full worker (MATTINA + POMERIGGIO).
      const otherRestDays = ids
        .filter(id => id !== rid)
        .map(id => restDay[id])
        .filter(d => workDays.includes(d));

      // Giorni ammessi per il turno ridotto
      const allowedDays = workDays.filter(d => !otherRestDays.includes(d));

      let chosen = [];
      if (forced && forced.length > 0) {
        // Valida i giorni forzati escludendo i giorni forzati-full
        const validForced = forced.filter(d =>
          d !== restDay[rid] && !otherRestDays.includes(d)
        );
        const unique = [...new Set(validForced)];
        if (unique.length !== validForced.length) return null; // duplicati
        chosen = unique;
        if (chosen.length < 2) {
          // Completa con il giorno con meno ridotti tra quelli permessi
          const avail = allowedDays
            .filter(d => !chosen.includes(d))
            .sort((a, b) => reducedCount[a] - reducedCount[b]);
          if (avail.length === 0) return null;
          chosen.push(avail[0]);
        }
      } else {
        if (allowedDays.length < 2) return null;
        // Scegli i 2 giorni con meno ridotti per distribuire uniformemente
        const sorted = [...allowedDays].sort((a, b) => reducedCount[a] - reducedCount[b]);
        chosen = sorted.slice(0, 2);
      }

      reducedDays[rid] = new Set(chosen);
      chosen.forEach(d => reducedCount[d]++);
    }

    // ── Passo 3: costruisce lo schedule giorno per giorno ──
    const schedule = {};
    for (const rid of ids) schedule[rid] = new Array(7).fill(null);

    // Marca i giorni di riposo
    for (const rid of ids) {
      schedule[rid][restDay[rid]] = { type: 'RIPOSO', start: null, end: null };
    }

    // Per ogni giorno assegna i tipi di turno
    for (let d = 0; d < 7; d++) {
      // Lavoratori a turno pieno quel giorno
      let fullW = shuffle(ids.filter(rid =>
        restDay[rid] !== d && !reducedDays[rid].has(d)
      ));
      // Lavoratori a turno ridotto quel giorno
      const redW = ids.filter(rid =>
        restDay[rid] !== d && reducedDays[rid].has(d)
      );

      // Se c'è un vincolo cavallo per questo giorno: sposta quel receptionist
      // alla fine dei lavoratori pieni (prenderà CAVALLO, non MATTINA o POMERIGGIO)
      if (constraints.cavalloRId && constraints.cavalloDay === d &&
          fullW.includes(constraints.cavalloRId) && fullW.length >= 3) {
        fullW = fullW.filter(id => id !== constraints.cavalloRId);
        fullW.push(constraints.cavalloRId);
      }

      if (fullW.length >= 2) {
        // ── Caso standard: MATTINA + POMERIGGIO (+ CAVALLO se 3+ pieni) ──
        let fi = 0;
        schedule[fullW[fi++]][d] = { type: 'MATTINA',    start: 420,  end: 870  };
        schedule[fullW[fi++]][d] = { type: 'POMERIGGIO', start: 870,  end: 1320 };
        while (fi < fullW.length) {
          const rid = fullW[fi++];
          const t = (constraints.cavalloRId === rid && constraints.cavalloDay === d)
            ? this.genCavallo(constraints.cavalloStart)
            : this.genCavallo();
          schedule[rid][d] = { type: 'CAVALLO', start: t.start, end: t.end };
        }
        // RIDOTTO con orario libero (MATTINA+POMERIGGIO garantiscono la copertura)
        for (const rid of redW) {
          const t = this.genRidotto();
          schedule[rid][d] = { type: 'RIDOTTO', start: t.start, end: t.end };
        }

      } else if (fullW.length === 1 && redW.length >= 2) {
        // ── Caso speciale: 1 pieno + 2 ridotti → CAVALLO coordinato ──
        // CAVALLO con start in [09:30, 12:00] garantisce copertura 07:00-22:00
        // insieme a RIDOTTO_1 (07:00-12:00) e RIDOTTO_2 (17:00-22:00).
        // Dimostrazione: S ∈ [570,720] → S ≤ 720 (no buco dopo RIDOTTO_1)
        //                              e S+450 ≥ 1020 (no buco prima di RIDOTTO_2).
        const cStart = (constraints.cavalloRId === fullW[0] &&
                        constraints.cavalloDay === d &&
                        constraints.cavalloStart !== undefined)
          ? Math.min(Math.max(constraints.cavalloStart, 570), 720)
          : randInt(570, 720);
        schedule[fullW[0]][d] = { type: 'CAVALLO', start: cStart, end: cStart + 450 };
        schedule[redW[0]][d]  = { type: 'RIDOTTO', start: 420,  end: 720  }; // 07:00–12:00
        schedule[redW[1]][d]  = { type: 'RIDOTTO', start: 1020, end: 1320 }; // 17:00–22:00
        // Eventuali ulteriori ridotti (con >3 persone) ricevono orario libero
        for (let i = 2; i < redW.length; i++) {
          const t = this.genRidotto();
          schedule[redW[i]][d] = { type: 'RIDOTTO', start: t.start, end: t.end };
        }

      } else if (fullW.length === 1) {
        // Fallback: un solo lavoratore presente
        schedule[fullW[0]][d] = { type: 'MATTINA', start: 420, end: 870 };
      }
    }

    // ── Passo 4: verifica che ogni slot sia compilato ──
    for (const rid of ids) {
      for (let d = 0; d < 7; d++) {
        if (!schedule[rid][d]) return null;
      }
    }

    return schedule;
  },

  /**
   * Valida uno schedule manualmente modificato.
   * Ritorna array di messaggi di errore/warning.
   */
  validate(schedule, receptionists) {
    const msgs = [];
    const ids = receptionists.map(r => r.id);

    // Conta tipi per persona
    for (const r of receptionists) {
      const slots = schedule[r.id];
      if (!slots) { msgs.push(`${r.name}: dati mancanti`); continue; }
      let full = 0, red = 0, rest = 0;
      let totalMin = 0;
      for (const s of slots) {
        if (!s) continue;
        if (s.type === 'RIPOSO') rest++;
        else if (s.type === 'RIDOTTO') { red++; totalMin += 300; }
        else { full++; totalMin += 450; }
      }
      if (rest !== 1) msgs.push(`${r.name}: ${rest} giorni di riposo (atteso 1)`);
      if (full !== 4) msgs.push(`${r.name}: ${full} turni pieni (attesi 4)`);
      if (red !== 2)  msgs.push(`${r.name}: ${red} turni ridotti (attesi 2)`);
      if (totalMin !== 2400) msgs.push(`${r.name}: ${Math.floor(totalMin/60)}h lavorate (attese 40h)`);
    }

    // Sovrapposizione giorni di riposo
    for (let d = 0; d < 7; d++) {
      const restingToday = ids.filter(rid => schedule[rid]?.[d]?.type === 'RIPOSO');
      if (restingToday.length > 1) {
        const nomi = restingToday.map(id => receptionists.find(r => r.id === id)?.name).join(', ');
        msgs.push(`${GIORNI[d]}: più receptionist in riposo (${nomi})`);
      }
    }

    return msgs;
  }
};

// ================================================================
// UI
// ================================================================

const UI = {
  currentView: 'weekly',
  editCtx: null, // { rId, dayIndex } della cella in modifica
  weeklyViewMode: 'grid', // 'grid' | 'list'

  init() {
    if (window.innerWidth <= 600) this.weeklyViewMode = 'list';
    this._bindNav();
    this._bindWeeklyControls();
    this._bindReceptionistForm();
    this._bindGenerateForm();
    this._bindModals();
    this._bindShiftSave();
    this._updateToggleIcon();
    this.navigate('weekly');
  },

  // ── Navigazione ──────────────────────────────────────────────

  navigate(view) {
    this.currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });
    this._renderView(view);
  },

  _renderView(view) {
    if (view === 'weekly')       this.renderWeekly();
    else if (view === 'receptionists') this.renderReceptionists();
    else if (view === 'generate') this.renderGenerate();
  },

  // ── Binding eventi fissi ──────────────────────────────────────

  _bindNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => this.navigate(btn.dataset.view));
    });
  },

  _bindWeeklyControls() {
    document.getElementById('prev-week').addEventListener('click', () => {
      State.currentWeek = prevWeekKey(State.currentWeek);
      State.save();
      this.renderWeekly();
    });
    document.getElementById('next-week').addEventListener('click', () => {
      State.currentWeek = nextWeekKey(State.currentWeek);
      State.save();
      this.renderWeekly();
    });
    document.getElementById('export-pdf').addEventListener('click', () => Export.toPDF());
    document.getElementById('export-csv').addEventListener('click', () => Export.toCSV());
    document.getElementById('toggle-view-mode').addEventListener('click', () => {
      this.weeklyViewMode = this.weeklyViewMode === 'grid' ? 'list' : 'grid';
      this._updateToggleIcon();
      this.renderWeekly();
    });
  },

  _updateToggleIcon() {
    const btn = document.getElementById('toggle-view-mode');
    if (!btn) return;
    // ⊞ quando si è in lista (click → va a griglia), ☰ quando si è in griglia (click → va a lista)
    btn.textContent = this.weeklyViewMode === 'grid' ? '☰' : '⊞';
    btn.title = this.weeklyViewMode === 'grid' ? 'Vista lista (mobile)' : 'Vista griglia (tabella)';
  },

  _bindReceptionistForm() {
    document.getElementById('add-receptionist').addEventListener('click', () => {
      const nameEl = document.getElementById('new-name');
      const colorEl = document.getElementById('new-color');
      const name = nameEl.value.trim();
      if (!name) { alert('Inserisci un nome per il receptionist.'); return; }
      State.addReceptionist(name, colorEl.value);
      nameEl.value = '';
      this.renderReceptionists();
    });
    document.getElementById('new-name').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('add-receptionist').click();
    });
  },

  _bindGenerateForm() {
    document.getElementById('mode-auto').addEventListener('click', () => {
      document.getElementById('mode-auto').classList.add('active');
      document.getElementById('mode-guided').classList.remove('active');
      document.getElementById('auto-mode-info').classList.remove('hidden');
      document.getElementById('guided-mode-form').classList.add('hidden');
    });
    document.getElementById('mode-guided').addEventListener('click', () => {
      document.getElementById('mode-guided').classList.add('active');
      document.getElementById('mode-auto').classList.remove('active');
      document.getElementById('guided-mode-form').classList.remove('hidden');
      document.getElementById('auto-mode-info').classList.add('hidden');
      this._renderGuidedForm();
    });
    document.getElementById('generate-btn').addEventListener('click', () => this._handleGenerate());
    document.getElementById('reset-btn').addEventListener('click', () => {
      this._showConfirm('Sei sicuro di voler cancellare tutti i turni? I receptionist rimarranno invariati.', async () => {
        await State.resetWeeks();
        document.getElementById('mode-auto').classList.add('active');
        document.getElementById('mode-guided').classList.remove('active');
        document.getElementById('auto-mode-info').classList.remove('hidden');
        document.getElementById('guided-mode-form').classList.add('hidden');
        this.navigate('weekly');
      });
    });
  },

  _bindModals() {
    // Chiusura modale tramite pulsante .modal-close
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.modal;
        if (target) this._closeModal(target);
        else this._closeAllModals();
      });
    });
    // Chiusura cliccando l'overlay
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) this._closeModal(overlay.id);
      });
    });
    // ESC
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this._closeAllModals();
    });
  },

  _bindShiftSave() {
    document.getElementById('shift-save').addEventListener('click', () => this._saveShiftEdit());
  },

  // ── Vista Piano Settimanale ───────────────────────────────────

  renderWeekly() {
    const wStart = weekStart(State.currentWeek);
    const wEnd = new Date(wStart);
    wEnd.setUTCDate(wEnd.getUTCDate() + 6);
    document.getElementById('week-label').textContent =
      `Settimana ${State.currentWeek}  (${fmtDate(wStart)} – ${fmtDate(wEnd)})`;

    const schedule = State.currentSchedule();
    const grid = document.getElementById('weekly-grid');

    if (!schedule) {
      grid.innerHTML = `
        <div class="empty-state">
          <span class="big-icon">📅</span>
          <p>Nessun piano generato per questa settimana.</p>
          <button class="btn btn-primary" onclick="UI.navigate('generate')">Genera Turni</button>
        </div>`;
      return;
    }

    const active = State.activeReceptionists();

    if (this.weeklyViewMode === 'list') {
      this._renderWeeklyList(schedule, active, wStart, grid);
    } else {
      this._renderWeeklyGrid(schedule, active, wStart, grid);
    }
  },

  _renderWeeklyGrid(schedule, active, wStart, grid) {
    let html = '<div class="grid-wrapper"><table class="weekly-table"><thead><tr>';
    html += '<th class="corner-cell">Receptionist</th>';
    for (let d = 0; d < 7; d++) {
      const date = new Date(wStart);
      date.setUTCDate(date.getUTCDate() + d);
      html += `<th class="day-header" data-day="${d}">
        <span class="day-name">${GIORNI_BREVI[d]}</span>
        <span class="day-date">${fmtDate(date)}</span>
      </th>`;
    }
    html += '<th class="hours-header">Ore</th></tr></thead><tbody>';

    for (const r of active) {
      const days = schedule[r.id] || [];
      let totalMin = 0;
      html += `<tr><td class="recept-label" style="border-left:4px solid ${r.color}">${this._esc(r.name)}</td>`;
      for (let d = 0; d < 7; d++) {
        const slot = days[d] || { type: 'RIPOSO', start: null, end: null };
        const def = TURNI[slot.type] || TURNI.RIPOSO;
        totalMin += def.duration;
        let timeStr = '';
        if (slot.type !== 'RIPOSO' && slot.start !== null) {
          timeStr = `${minToTime(slot.start)}–${minToTime(slot.end)}`;
        }
        html += `<td class="shift-cell" data-rid="${r.id}" data-day="${d}">
          <div class="shift-badge ${def.cssClass}">
            <span class="shift-type">${def.label}</span>
            ${timeStr ? `<span class="shift-time">${timeStr}</span>` : ''}
          </div>
        </td>`;
      }
      const hh = Math.floor(totalMin / 60), mm = totalMin % 60;
      const cls = totalMin === 2400 ? 'ok' : 'warn';
      html += `<td class="hours-cell ${cls}">${hh}h ${String(mm).padStart(2,'0')}m</td></tr>`;
    }

    html += '</tbody><tfoot><tr><td class="corner-cell">Copertura</td>';
    for (let d = 0; d < 7; d++) {
      const daySlots = active.map(r => (schedule[r.id] || [])[d]).filter(Boolean);
      const gaps = Engine.computeGaps(daySlots);
      const ok = gaps.length === 0;
      const gapStr = gaps.map(g => `${minToTime(g.start)}–${minToTime(g.end)}`).join(', ');
      html += `<td class="coverage-cell ${ok ? 'covered' : 'uncovered'}" title="${ok ? 'Copertura completa' : 'Buchi: '+gapStr}">
        ${ok ? '✓' : '✗'}
        ${!ok && gapStr ? `<span class="gap-hint">${gapStr}</span>` : ''}
      </td>`;
    }
    html += '<td></td></tr></tfoot></table></div>';
    grid.innerHTML = html;

    grid.querySelectorAll('.shift-cell').forEach(cell => {
      cell.addEventListener('click', () =>
        this._openShiftEditor(cell.dataset.rid, parseInt(cell.dataset.day, 10)));
    });
    grid.querySelectorAll('.day-header').forEach(th => {
      th.addEventListener('click', () =>
        this._openDailyView(parseInt(th.dataset.day, 10)));
    });
  },

  _renderWeeklyList(schedule, active, wStart, grid) {
    let html = '<div class="day-list">';

    for (let d = 0; d < 7; d++) {
      const date = new Date(wStart);
      date.setUTCDate(date.getUTCDate() + d);
      const daySlots = active.map(r => (schedule[r.id] || [])[d]).filter(Boolean);
      const gaps = Engine.computeGaps(daySlots);
      const ok = gaps.length === 0;
      const gapStr = gaps.map(g => `${minToTime(g.start)}–${minToTime(g.end)}`).join(', ');
      const coverageTitle = ok ? 'Copertura completa' : `Buchi: ${gapStr}`;

      html += `<div class="day-list-card${ok ? '' : ' uncovered'}">
        <div class="day-list-header" data-day="${d}" title="${coverageTitle}">
          <span class="day-info">${GIORNI[d]}<span class="day-date-sub">${fmtDate(date)}</span></span>
          <span class="coverage-badge">${ok ? '✓' : '✗'}</span>
        </div>
        <div class="day-list-body">`;

      for (const r of active) {
        const slot = (schedule[r.id] || [])[d] || { type: 'RIPOSO', start: null, end: null };
        const def = TURNI[slot.type] || TURNI.RIPOSO;
        let timeStr = '';
        if (slot.type !== 'RIPOSO' && slot.start !== null) {
          timeStr = `${minToTime(slot.start)}–${minToTime(slot.end)}`;
        }
        // Calcola colori inline dal CSS custom property equivalente
        const col = TIMELINE_COLORS[slot.type] || TIMELINE_COLORS.RIPOSO;
        html += `<div class="day-list-row" data-rid="${r.id}" data-day="${d}">
          <span class="day-list-dot" style="background:${r.color}"></span>
          <span class="day-list-name">${this._esc(r.name)}</span>
          <span class="day-list-badge" style="background:${col.bg};color:${col.text}">${def.label}</span>
          ${timeStr ? `<span class="day-list-time">${timeStr}</span>` : ''}
        </div>`;
      }

      html += `</div></div>`;
    }

    html += '</div>';
    grid.innerHTML = html;

    // Click su header giorno → vista giornaliera
    grid.querySelectorAll('.day-list-header').forEach(hdr => {
      hdr.addEventListener('click', () =>
        this._openDailyView(parseInt(hdr.dataset.day, 10)));
    });
    // Click su riga turno → modifica turno
    grid.querySelectorAll('.day-list-row').forEach(row => {
      row.addEventListener('click', () =>
        this._openShiftEditor(row.dataset.rid, parseInt(row.dataset.day, 10)));
    });
  },

  // ── Vista Giornaliera ─────────────────────────────────────────

  _openDailyView(dayIndex) {
    const schedule = State.currentSchedule();
    if (!schedule) return;

    const wStart = weekStart(State.currentWeek);
    const date = new Date(wStart);
    date.setUTCDate(date.getUTCDate() + dayIndex);
    document.getElementById('daily-title').textContent =
      `${GIORNI[dayIndex]}, ${fmtDate(date)}`;

    const active = State.activeReceptionists();
    const workSlots = active
      .map(r => ({ ...((schedule[r.id] || [])[dayIndex] || { type: 'RIPOSO' }), receptionist: r }))
      .filter(s => s.type !== 'RIPOSO');

    const allSlots = active.map(r => (schedule[r.id] || [])[dayIndex]).filter(Boolean);
    const gaps = Engine.computeGaps(allSlots);

    // Timeline: 07:00(420) – 22:00(1320) = 900 minuti
    const TOTAL = 900;
    const OFFSET = 420;
    const pct = m => ((m - OFFSET) / TOTAL * 100).toFixed(3) + '%';
    const wPct = dur => (dur / TOTAL * 100).toFixed(3) + '%';

    let html = '';

    // Asse orario
    html += '<div class="time-axis" style="margin-left:130px;margin-right:10px;position:relative;height:30px;border-bottom:2px solid var(--border-2);margin-bottom:10px;">';
    for (let h = 7; h <= 22; h++) {
      html += `<div class="time-tick" style="position:absolute;left:${pct(h*60)};transform:translateX(-50%);font-size:0.68rem;color:var(--text-3);bottom:4px;white-space:nowrap;">
        <span>${String(h).padStart(2,'0')}:00</span>
      </div>`;
    }
    html += '</div>';

    if (workSlots.length === 0) {
      html += '<p style="text-align:center;color:var(--text-3);padding:20px;">Tutti i receptionist sono in riposo oggi.</p>';
    }

    // Righe turni
    for (const s of workSlots) {
      const def = TURNI[s.type] || TURNI.RIPOSO;
      const col = TIMELINE_COLORS[s.type] || TIMELINE_COLORS.RIPOSO;
      const left = pct(s.start);
      const width = wPct(s.end - s.start);
      const label = `${def.label} ${minToTime(s.start)}–${minToTime(s.end)}`;
      html += `<div class="timeline-row">
        <div class="timeline-label" style="color:${s.receptionist.color}">${this._esc(s.receptionist.name)}</div>
        <div class="timeline-bar-area">
          <div class="timeline-bar"
            style="left:${left};width:${width};background:${col.bg};color:${col.text};"
            title="${label}">
            ${label}
          </div>
        </div>
      </div>`;
    }

    // Riga buchi
    if (gaps.length > 0) {
      html += `<div class="timeline-row">
        <div class="timeline-label gap-label">Buchi</div>
        <div class="timeline-bar-area">`;
      for (const g of gaps) {
        html += `<div class="timeline-gap"
          style="position:absolute;left:${pct(g.start)};width:${wPct(g.end-g.start)};height:100%;"
          title="Buco: ${minToTime(g.start)}–${minToTime(g.end)}"></div>`;
      }
      html += '</div></div>';
    }

    const gapStr = gaps.length === 0
      ? '✅ Copertura completa (07:00–22:00)'
      : `⚠️ Buchi: ${gaps.map(g => `${minToTime(g.start)}–${minToTime(g.end)}`).join(', ')}`;
    html += `<p class="timeline-coverage-note">${gapStr}</p>`;

    document.getElementById('daily-timeline').innerHTML = html;
    this._openModal('modal-daily');
  },

  // ── Vista Receptionist ────────────────────────────────────────

  renderReceptionists() {
    const list = document.getElementById('receptionists-list');
    let html = '';

    for (const r of State.receptionists) {
      const isActive = r.active;
      html += `<div class="receptionist-card${isActive ? '' : ' inactive'}">
        <div class="recept-color-dot" style="background:${r.color}"></div>
        <div class="recept-info">
          <div class="name">${this._esc(r.name)}</div>
          <span class="status-badge ${isActive ? 'attivo' : 'inattivo'}">${isActive ? 'Attivo' : 'Inattivo'}</span>
        </div>
        <div class="recept-actions">
          <button class="btn btn-secondary btn-rename" data-id="${r.id}">✏️ Rinomina</button>
          <button class="btn btn-secondary btn-chcolor" data-id="${r.id}">🎨 Colore</button>
          ${isActive
            ? `<button class="btn btn-danger btn-deact" data-id="${r.id}">Disattiva</button>`
            : `<button class="btn btn-secondary btn-act" data-id="${r.id}">Attiva</button>`}
        </div>
      </div>`;
    }

    const n = State.activeReceptionists().length;
    html += `<p class="active-count">Receptionist attivi: <strong>${n}</strong> (minimo 3 richiesti)</p>`;
    list.innerHTML = html;

    list.querySelectorAll('.btn-rename').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = State.findById(btn.dataset.id);
        const nome = prompt('Nuovo nome:', r?.name || '');
        if (nome && nome.trim()) {
          State.updateReceptionist(btn.dataset.id, { name: nome.trim() });
          this.renderReceptionists();
        }
      });
    });

    list.querySelectorAll('.btn-chcolor').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = State.findById(btn.dataset.id);
        const inp = Object.assign(document.createElement('input'), { type: 'color', value: r?.color || '#000' });
        inp.addEventListener('change', () => {
          State.updateReceptionist(btn.dataset.id, { color: inp.value });
          this.renderReceptionists();
        });
        inp.click();
      });
    });

    list.querySelectorAll('.btn-deact').forEach(btn => {
      btn.addEventListener('click', () => {
        const ok = State.deactivateReceptionist(btn.dataset.id);
        if (!ok) alert('Impossibile disattivare: devono esserci almeno 3 receptionist attivi.');
        else this.renderReceptionists();
      });
    });

    list.querySelectorAll('.btn-act').forEach(btn => {
      btn.addEventListener('click', () => {
        State.updateReceptionist(btn.dataset.id, { active: true });
        this.renderReceptionists();
      });
    });
  },

  // ── Vista Genera Turni ────────────────────────────────────────

  renderGenerate() {
    const isGuided = document.getElementById('mode-guided').classList.contains('active');
    if (isGuided) this._renderGuidedForm();
    document.getElementById('generate-error').classList.add('hidden');
  },

  _renderGuidedForm() {
    const active = State.activeReceptionists();
    const container = document.getElementById('guided-form-content');

    const dayOpts = () =>
      `<option value="">Casuale</option>` +
      GIORNI.map((g, i) => `<option value="${i}">${g}</option>`).join('');

    let html = `<div class="constraint-section">
      <h4>Giorno di riposo forzato</h4>`;
    for (const r of active) {
      html += `<div class="constraint-row">
        <label style="color:${r.color}">${this._esc(r.name)}:</label>
        <select name="rest_${r.id}">${dayOpts()}</select>
      </div>`;
    }
    html += `</div>
    <div class="constraint-section">
      <h4>Giorni ridotti forzati (fino a 2 per persona)</h4>`;
    for (const r of active) {
      html += `<div class="constraint-row">
        <label style="color:${r.color}">${this._esc(r.name)}:</label>
        <select name="red1_${r.id}">${dayOpts()}</select>
        <select name="red2_${r.id}">${dayOpts()}</select>
      </div>`;
    }
    html += `</div>
    <div class="constraint-section">
      <h4>Turno a cavallo</h4>
      <div class="constraint-row">
        <label>Receptionist:</label>
        <select name="cavallo_r">
          <option value="">Casuale</option>
          ${active.map(r => `<option value="${r.id}">${this._esc(r.name)}</option>`).join('')}
        </select>
      </div>
      <div class="constraint-row">
        <label>Giorno:</label>
        <select name="cavallo_day">${dayOpts()}</select>
      </div>
      <div class="constraint-row">
        <label>Orario inizio (opz.):</label>
        <input type="time" name="cavallo_start" min="07:01" max="14:29" placeholder="07:01 – 14:29">
      </div>
    </div>`;

    container.innerHTML = html;
  },

  _handleGenerate() {
    const active = State.activeReceptionists();
    const errEl = document.getElementById('generate-error');
    errEl.classList.add('hidden');

    if (active.length < 3) {
      errEl.textContent = '⚠️ Servono almeno 3 receptionist attivi per generare il piano.';
      errEl.classList.remove('hidden');
      return;
    }

    const isGuided = document.getElementById('mode-guided').classList.contains('active');
    const constraints = isGuided ? this._collectConstraints(active, errEl) : {};
    if (constraints === null) return; // errore già mostrato

    const schedule = Engine.generate(active, constraints);
    if (!schedule) {
      errEl.textContent = '⚠️ Impossibile generare il piano con i vincoli forniti. Prova a rimuovere o cambiare i vincoli.';
      errEl.classList.remove('hidden');
      return;
    }

    State.saveSchedule(State.currentWeek, schedule);
    this.navigate('weekly');
  },

  _collectConstraints(active, errEl) {
    const c = {};

    // Giorni di riposo
    const restDays = {};
    for (const r of active) {
      const val = document.querySelector(`[name="rest_${r.id}"]`)?.value;
      if (val !== '' && val !== undefined && val !== null) restDays[r.id] = parseInt(val, 10);
    }
    if (Object.keys(restDays).length) c.restDays = restDays;

    // Giorni ridotti
    const reducedDays = {};
    for (const r of active) {
      const v1 = document.querySelector(`[name="red1_${r.id}"]`)?.value;
      const v2 = document.querySelector(`[name="red2_${r.id}"]`)?.value;
      const days = [];
      if (v1 !== '' && v1 !== undefined) days.push(parseInt(v1, 10));
      if (v2 !== '' && v2 !== undefined) days.push(parseInt(v2, 10));
      if (days.length === 2 && days[0] === days[1]) {
        errEl.textContent = `⚠️ I due giorni ridotti di ${r.name} devono essere diversi.`;
        errEl.classList.remove('hidden');
        return null;
      }
      if (days.length > 0) reducedDays[r.id] = days;
    }
    if (Object.keys(reducedDays).length) c.reducedDays = reducedDays;

    // Cavallo
    const cR = document.querySelector('[name="cavallo_r"]')?.value;
    const cD = document.querySelector('[name="cavallo_day"]')?.value;
    const cS = document.querySelector('[name="cavallo_start"]')?.value;
    if (cR) c.cavalloRId = cR;
    if (cD !== '' && cD !== undefined) c.cavalloDay = parseInt(cD, 10);
    if (cS) {
      const m = timeToMin(cS);
      if (m < 421 || m > 869) {
        errEl.textContent = '⚠️ L\'orario di inizio del turno a cavallo deve essere tra 07:01 e 14:29.';
        errEl.classList.remove('hidden');
        return null;
      }
      c.cavalloStart = m;
    }

    return c;
  },

  // ── Editor turno ──────────────────────────────────────────────

  _openShiftEditor(rId, dayIndex) {
    const schedule = State.currentSchedule();
    if (!schedule) return;
    const r = State.findById(rId);
    const slot = (schedule[rId] || [])[dayIndex] || { type: 'RIPOSO', start: null, end: null };
    this.editCtx = { rId, dayIndex };

    document.getElementById('shift-editor-title').textContent =
      `Modifica turno — ${r?.name || rId} / ${GIORNI[dayIndex]}`;

    const defStart = slot.start !== null ? minToTime(slot.start) : '07:00';
    const defEnd   = slot.end   !== null ? minToTime(slot.end)   : '14:30';

    const tipoOpts = Object.entries(TURNI)
      .map(([k, v]) => `<option value="${k}" ${slot.type === k ? 'selected' : ''}>${v.label}</option>`)
      .join('');

    const isRiposo = slot.type === 'RIPOSO';

    document.getElementById('shift-editor-form').innerHTML = `
      <div class="shift-form">
        <div class="form-group">
          <label>Tipo turno</label>
          <select id="edit-type">${tipoOpts}</select>
        </div>
        <div id="time-inputs" ${isRiposo ? 'style="display:none"' : ''}>
          <div class="time-row">
            <div class="form-group">
              <label>Inizio</label>
              <input type="time" id="edit-start" value="${defStart}" step="60">
            </div>
            <div class="form-group">
              <label>Fine</label>
              <input type="time" id="edit-end" value="${defEnd}" step="60">
            </div>
          </div>
        </div>
      </div>`;

    document.getElementById('shift-warning').classList.add('hidden');

    const typeEl  = document.getElementById('edit-type');
    const startEl = document.getElementById('edit-start');
    const endEl   = document.getElementById('edit-end');
    const timeDv  = document.getElementById('time-inputs');

    const onTypeChange = () => {
      const t = typeEl.value;
      timeDv.style.display = t === 'RIPOSO' ? 'none' : '';
      const def = TURNI[t];
      if (def?.fixed) {
        startEl.value = minToTime(def.start);
        endEl.value   = minToTime(def.end);
      }
      this._validateShiftEdit();
    };

    typeEl.addEventListener('change', onTypeChange);
    startEl.addEventListener('change', () => this._validateShiftEdit());
    endEl.addEventListener('change', () => this._validateShiftEdit());

    this._validateShiftEdit();
    this._openModal('modal-shift');
  },

  _validateShiftEdit() {
    const type = document.getElementById('edit-type')?.value;
    if (!type) return;
    const warns = [];

    if (type !== 'RIPOSO') {
      const start = timeToMin(document.getElementById('edit-start')?.value);
      const end   = timeToMin(document.getElementById('edit-end')?.value);

      if (start === null || end === null) { warns.push('Inserisci inizio e fine.'); }
      else {
        if (start < 420) warns.push('L\'inizio è prima delle 07:00.');
        if (end   > 1320) warns.push('La fine è dopo le 22:00.');
        if (end  <= start) warns.push('La fine deve essere dopo l\'inizio.');

        const dur = end - start;
        if (type === 'MATTINA' && (start !== 420 || end !== 870))
          warns.push('Il turno Mattina è fisso 07:00–14:30.');
        if (type === 'POMERIGGIO' && (start !== 870 || end !== 1320))
          warns.push('Il turno Pomeriggio è fisso 14:30–22:00.');
        if (type === 'CAVALLO') {
          if (Math.abs(dur - 450) > 1)  warns.push(`Il turno A cavallo deve durare 7h30m (attuale: ${Math.floor(dur/60)}h${dur%60}m).`);
          if (start <= 420)             warns.push('Il turno A cavallo deve iniziare dopo le 07:00.');
          if (start >= 870)             warns.push('Il turno A cavallo deve iniziare prima delle 14:30.');
          if (end   <= 870)             warns.push('Il turno A cavallo deve finire dopo le 14:30.');
        }
        if (type === 'RIDOTTO' && Math.abs(dur - 300) > 1)
          warns.push(`Il turno Ridotto deve durare 5h (attuale: ${Math.floor(dur/60)}h${dur%60}m).`);
      }
    }

    const warnEl = document.getElementById('shift-warning');
    if (warns.length) {
      warnEl.textContent = '⚠ ' + warns.join(' ');
      warnEl.classList.remove('hidden');
    } else {
      warnEl.classList.add('hidden');
    }
  },

  _saveShiftEdit() {
    if (!this.editCtx) return;
    const { rId, dayIndex } = this.editCtx;
    const type = document.getElementById('edit-type').value;
    let start = null, end = null;
    if (type !== 'RIPOSO') {
      start = timeToMin(document.getElementById('edit-start').value);
      end   = timeToMin(document.getElementById('edit-end').value);
    }
    const schedule = State.currentSchedule();
    if (schedule && schedule[rId]) {
      schedule[rId][dayIndex] = { type, start, end };
      State.saveSchedule(State.currentWeek, schedule);
    }
    this._closeModal('modal-shift');
    this.editCtx = null;
    this.renderWeekly();
  },

  // ── Modale conferma ───────────────────────────────────────────

  _showConfirm(msg, onOk) {
    document.getElementById('confirm-message').textContent = msg;
    const btn = document.getElementById('confirm-ok');
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);
    fresh.addEventListener('click', () => { this._closeModal('modal-confirm'); onOk(); });
    this._openModal('modal-confirm');
  },

  // ── Helpers modali ────────────────────────────────────────────

  _openModal(id) {
    document.getElementById(id).classList.remove('hidden');
  },
  _closeModal(id) {
    document.getElementById(id).classList.add('hidden');
  },
  _closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
    this.editCtx = null;
  },

  // ── Escape HTML ───────────────────────────────────────────────
  _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
};

// ================================================================
// EXPORT — PDF e CSV
// ================================================================

const Export = {

  toCSV() {
    const schedule = State.currentSchedule();
    if (!schedule) { alert('Nessun piano da esportare per questa settimana.'); return; }

    const active = State.activeReceptionists();
    const wStart = weekStart(State.currentWeek);

    const headers = ['Receptionist',
      ...GIORNI.map((g, i) => {
        const d = new Date(wStart);
        d.setUTCDate(d.getUTCDate() + i);
        return `${g} ${fmtDate(d)}`;
      }),
      'Totale ore'
    ];

    const rows = active.map(r => {
      const days = schedule[r.id] || [];
      let totalMin = 0;
      const cells = days.map(s => {
        if (!s) return 'RIPOSO';
        const def = TURNI[s.type] || TURNI.RIPOSO;
        totalMin += def.duration;
        if (s.type === 'RIPOSO' || s.start === null) return def.label;
        return `${def.label} ${minToTime(s.start)}-${minToTime(s.end)}`;
      });
      const h = Math.floor(totalMin / 60), m = totalMin % 60;
      return [r.name, ...cells, `${h}h${String(m).padStart(2,'0')}m`];
    });

    let csv = headers.join(',') + '\n';
    for (const row of rows) {
      csv += row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',') + '\n';
    }

    this._download(
      new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }),
      `turni_${State.currentWeek}.csv`
    );
  },

  toPDF() {
    const schedule = State.currentSchedule();
    if (!schedule) { alert('Nessun piano da esportare per questa settimana.'); return; }
    if (!window.jspdf) { alert('Libreria jsPDF non disponibile. Verifica la connessione internet.'); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const active = State.activeReceptionists();
    const wStart = weekStart(State.currentWeek);

    // Titolo
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text(`Piano Turni Reception – ${State.currentWeek}`, 14, 14);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9);
    doc.text(`Generato il ${new Date().toLocaleDateString('it-IT')}`, 14, 20);

    const head = [['Receptionist',
      ...GIORNI_BREVI.map((g, i) => {
        const d = new Date(wStart);
        d.setUTCDate(d.getUTCDate() + i);
        return `${g}\n${fmtDate(d)}`;
      }),
      'Ore'
    ]];

    // Colori hex → RGB
    const hexRgb = hex => {
      const n = parseInt(hex.replace('#', ''), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };

    // Mappatura tipo → colore PDF (versioni chiare)
    const PDF_COLORS = {
      MATTINA:    [179, 229, 252],
      POMERIGGIO: [255, 224, 178],
      CAVALLO:    [225, 190, 231],
      RIDOTTO:    [255, 249, 196],
      RIPOSO:     [236, 239, 241]
    };

    const body = active.map(r => {
      const days = schedule[r.id] || [];
      let totalMin = 0;
      const cells = days.map(s => {
        if (!s) return 'Riposo';
        const def = TURNI[s.type] || TURNI.RIPOSO;
        totalMin += def.duration;
        if (s.type === 'RIPOSO' || s.start === null) return def.label;
        return `${def.label}\n${minToTime(s.start)}-${minToTime(s.end)}`;
      });
      const h = Math.floor(totalMin / 60), m = totalMin % 60;
      return [r.name, ...cells, `${h}h ${String(m).padStart(2,'0')}m`];
    });

    // Tipi di turno per ogni cella (per il coloring)
    const bodyTypes = active.map(r => {
      const days = schedule[r.id] || [];
      return days.map(s => s?.type || 'RIPOSO');
    });

    doc.autoTable({
      head,
      body,
      startY: 25,
      styles: { fontSize: 8, cellPadding: 2, valign: 'middle', halign: 'center', lineColor: [200,200,200], lineWidth: 0.2 },
      headStyles: { fillColor: [21, 101, 192], textColor: 255, fontStyle: 'bold' },
      columnStyles: {
        0: { fontStyle: 'bold', halign: 'left', cellWidth: 32, fillColor: [245,247,250] },
        8: { cellWidth: 20, fillColor: [245,247,250] }
      },
      didParseCell(data) {
        if (data.section === 'body' && data.column.index >= 1 && data.column.index <= 7) {
          const rIdx = data.row.index;
          const dIdx = data.column.index - 1;
          const type = bodyTypes[rIdx]?.[dIdx] || 'RIPOSO';
          data.cell.styles.fillColor = PDF_COLORS[type] || PDF_COLORS.RIPOSO;
          if (type !== 'RIPOSO') data.cell.styles.fontStyle = 'bold';
        }
      }
    });

    // Legenda
    let fy = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.text('Legenda:', 14, fy);
    doc.setFont(undefined, 'normal');
    const legend = Object.entries(TURNI).map(([k, v]) => ({ label: v.label, color: PDF_COLORS[k] }));
    let lx = 35;
    for (const item of legend) {
      doc.setFillColor(...item.color);
      doc.rect(lx, fy - 4, 5, 5, 'F');
      doc.setDrawColor(180, 180, 180);
      doc.rect(lx, fy - 4, 5, 5, 'S');
      doc.text(item.label, lx + 7, fy);
      lx += 38;
    }

    doc.save(`turni_${State.currentWeek}.pdf`);
  },

  _download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};

// ================================================================
// INIT
// ================================================================

document.addEventListener('DOMContentLoaded', async () => {
  const loadingEl = document.getElementById('loading-overlay');
  if (loadingEl) loadingEl.classList.remove('hidden');
  try {
    await State.load();
  } catch (err) {
    console.error('[Firebase] Impossibile caricare i dati:', err);
    State.receptionists = deepClone(DEFAULT_RECEPTIONISTS);
    State.weeks = {};
    State.currentWeek = weekKey(new Date());
    alert('Connessione al database non riuscita. I dati potrebbero non essere sincronizzati.');
  }
  if (loadingEl) loadingEl.classList.add('hidden');
  UI.init();
});
