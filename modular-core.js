/* Open Modular — independent musical clocks, shared harmonic context.
 * Pure composition and score validation; used by the shared worker and tests.
 * This has its own score version and does not change solo engines 1 or 3. */
(function(root) {
  "use strict";
  const VERSION = 4;
  const MAX_MEMBERS = 8;
  const SCORE_SECONDS = 1800;
  const MIN_BPM = 60 / 15.5;
  const MAX_BPM = 20;
  const MAX_ATTACKS = MAX_MEMBERS * MAX_BPM;
  const MAX_EVENTS = 5120;
  const TAIL = 10.465;
  const SCALE = [0, 2, 4, 5, 7, 9, 11];
  const CHORDS = [
    { name: "I", tones: [0, 4, 7] }, { name: "IV", tones: [5, 9, 0] },
    { name: "V", tones: [7, 11, 2] }, { name: "vi", tones: [9, 0, 4] },
    { name: "ii", tones: [2, 5, 9] },
    { name: "iii", tones: [4, 7, 11] },
    { name: "Imaj7", tones: [0, 4, 7, 11] },
    { name: "IVmaj7", tones: [5, 9, 0, 4] },
    { name: "ii7", tones: [2, 5, 9, 0] },
    { name: "vi7", tones: [9, 0, 4, 7] },
    { name: "V7", tones: [7, 11, 2, 5] },
    { name: "V7/vi", tones: [4, 8, 11, 2] }
  ];
  // Minor-centered arcs in the shared major/relative-minor pitch framework.
  // For a C reference these include Am–Dm–E7–Am7–Fmaj7 and Dm7–G7–Cmaj7.
  const PROGRESSIONS = [
    ["vi", "ii", "V7/vi", "vi7", "IVmaj7", "ii7", "V7/vi", "vi"],
    ["vi", "iii", "IVmaj7", "ii7", "V7", "Imaj7", "V7/vi", "vi"],
    ["vi", "vi7", "ii7", "V7", "Imaj7", "IVmaj7", "ii", "V7/vi", "vi"]
  ].map(names => names.map(name => CHORDS.findIndex(chord => chord.name === name)));
  const pc = n => ((n % 12) + 12) % 12;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const clock = () => (performance.timeOrigin + performance.now()) / 1000;
  function random(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function choose(items, rng) {
    let x = rng() * items.reduce((n, item) => n + item.weight, 0);
    for (const item of items) { x -= item.weight; if (x <= 0) return item.value; }
    return items.at(-1).value;
  }
  function chordDissonanceAllowed(a, b, chord) {
    if (chord.length < 4 || !chord.includes(pc(a)) || !chord.includes(pc(b))) return false;
    const distance = Math.abs(a - b);
    // A chordal major seventh (or its compound inversion) is intentional color.
    // Keep adjacent semitones out of the low bell register; dominant tritones
    // are valid chord tones rather than blanket forbidden intervals.
    return ([1, 11].includes(pc(distance)) && distance >= 11) || pc(distance) === 6;
  }
  function compatible(semi, sounding, chord = []) {
    return sounding.every(n => ![1, 6, 11].includes(pc(semi - n.semi)) || chordDissonanceAllowed(semi, n.semi, chord));
  }

  // One diatonic step away from a chord tone, with a destination already chosen.
  function ornamentsFrom(anchor, chord, scale, tone) {
    if (anchor === null || !chord.includes(pc(anchor))) return [];
    const inRange = semi => tone * Math.pow(2, semi / 12) >= 110 && tone * Math.pow(2, semi / 12) <= 415.30;
    const step = (semi, direction) => [1, 2].map(n => semi + direction * n).find(n => scale.includes(pc(n)));
    const options = [];
    for (const direction of [-1, 1]) {
      const semi = step(anchor, direction);
      if (semi === undefined || !inRange(semi) || chord.includes(pc(semi))) continue;
      options.push({ type: "neighbor", semi, target: anchor });
      const target = step(semi, direction);
      if (target !== undefined && inRange(target) && chord.includes(pc(target)))
        options.push({ type: "passing", semi, target });
    }
    return options;
  }

  // These are preferences from tonal voice leading, not strict SATB rules.
  function voiceLeadingWeight(member, semi, peers, chord, harmonyChanged) {
    if (member.lastSemi === null) return 1;
    const movement = semi - member.lastSemi, distance = Math.abs(movement);
    let weight = distance <= 2 ? 3 : distance <= 4 ? 1.4 : distance <= 7 ? 0.6 : 0.15;
    if (harmonyChanged && movement === 0 && chord.includes(pc(semi)) && member.lastChord.includes(pc(semi))) weight *= 6;
    for (const peer of peers) {
      const before = member.peerPitches.get(peer.id);
      if (peer.id === member.id || before == null || peer.lastSemi == null) continue;
      const otherMovement = peer.lastSemi - before;
      if (movement && otherMovement && Math.sign(movement) !== Math.sign(otherMovement)) weight *= 1.4;
      else if ((!movement && otherMovement) || (movement && !otherMovement)) weight *= 1.15;
      const oldInterval = Math.abs(member.lastSemi - before) % 12;
      const newInterval = Math.abs(semi - peer.lastSemi) % 12;
      if (movement && otherMovement && Math.sign(movement) === Math.sign(otherMovement) &&
          oldInterval === newInterval && [0, 7].includes(newInterval)) weight *= 0.2;
      if ((member.lastSemi - before) * (semi - peer.lastSemi) < 0) weight *= 0.35;
    }
    return weight;
  }

  function overlapWeight(semi, sounding, at, member, resolution, chord = []) {
    let weight = 1;
    for (const old of sounding) {
      const interval = pc(semi - old.semi);
      if (![1, 6, 11].includes(interval)) continue;
      if (chordDissonanceAllowed(semi, old.semi, chord)) { weight *= 0.8; continue; }
      const age = at - old.at;
      // A bell is already much quieter halfway through its exponential decay.
      // Bass has a slow attack, so it keeps the full-duration protection.
      const quietBell = old.kind === "bell" && age >= old.duration * 0.5;
      const resolvingOwnNote = resolution && old.kind === "bell" && old.performer === member.id &&
        old.semi === member.lastSemi && age >= Math.min(4, old.duration * 0.25);
      if (!quietBell && !resolvingOwnNote) return 0;
      weight *= resolvingOwnNote ? 0.7 : 0.3;
    }
    return weight;
  }

  class Ensemble {
    constructor({ seed, tone, now }) {
      if (!Number.isInteger(tone) || tone < 110 || tone > 200) throw Error("Choose a root from 110 to 200 Hz.");
      this.seed = seed >>> 0;
      this.tone = tone;
      this.rng = random(this.seed);
      this.bassRng = random((this.seed ^ 0xBA550) >>> 0);
      this.members = new Map();
      this.events = [];
      this.sounding = [];
      this.attacks = [];
      this.sequence = 0;
      this.progression = PROGRESSIONS[Math.floor(this.rng() * PROGRESSIONS.length)];
      this.progressionStep = 0;
      this.pendingHarmony = null;
      this.chord = this.progression[0];
      this.key = 0;
      this.harmonyChanges = 0;
      this.harmonySerial = 0;
      this.nextHarmony = now + 75;
      this.previous = null;
      this.lastBassSemi = null;
      this.bassHarmony = -1;
      this.inversion = null;
    }
    join(id, { seed, length, now }) {
      if (this.members.has(id)) return;
      if (this.members.size >= MAX_MEMBERS) throw Error("This ensemble already has eight windows.");
      if (!["short", "long", "infinite"].includes(length)) throw Error("Choose Short, Long, or Infinite.");
      const rng = random(seed);
      const duration = length === "short" ? 60 : length === "long" ? 600 + Math.floor(rng() * 1201) : Infinity;
      // Timing depends only on this voice's seed and start, never on its peers,
      // melodic choices, or the ensemble size. Separate clocks naturally drift.
      const timingRng = random((seed ^ 0x54494D45) >>> 0);
      const period = 60 / (MIN_BPM + timingRng() * (MAX_BPM - MIN_BPM));
      const phase = now + 2.5 + timingRng() * 3;
      this.members.set(id, {
        id, seed: seed >>> 0, length, rng, period, phase, pulse: 0,
        mixRng: random((seed ^ 0xC01A0B0) >>> 0), panCenter: null, brightness: null,
        nextAt: phase, deadline: now + duration,
        step: 0, lastSemi: null, lastDelta: 0, lastKey: null, lastChord: [],
        lastHarmony: -1, peerPitches: new Map(), resolution: null, ornamentAfter: 0, ending: false, endAt: Infinity
      });
    }
    leave(id, now) {
      this.members.delete(id);
      // A stopped/closed window cannot play its already dispatched future note.
      this.events = this.events.filter(e => e.performer !== id || e.at <= now);
      this.sounding = this.sounding.filter(n => n.performer !== id || n.at <= now);
      this.attacks = this.attacks.filter(e => e.performer !== id || e.at <= now);
    }
    roles() {
      const playing = [...this.members.values()].filter(m => !m.ending);
      return new Map(playing.map((m, i) => [m.id, {
        center: playing.length === 1 ? 220 : 145 * Math.pow(340 / 145, i / (playing.length - 1)),
        pan: playing.length === 1 ? 0 : -0.5 + i / (playing.length - 1),
        name: playing.length === 1 ? "Solo" : i === 0 ? "Lower voice" : i === playing.length - 1 ? "Upper voice" : "Middle voice"
      }]));
    }
    state() {
      const roles = this.roles();
      return { tone: this.tone, seed: this.seed, harmony: CHORDS[this.chord].name, inversion: this.inversion,
        members: [...this.members.values()].map(m => ({ id: m.id, length: m.length,
          role: m.ending ? "Finishing" : roles.get(m.id).name, bpm: 60 / m.period, ending: m.ending })) };
    }
    harmony(at) {
      if (at < this.nextHarmony) return;
      if ([...this.members.values()].some(m => !m.ending && m.resolution)) {
        this.nextHarmony = at + 10;
        return;
      }
      if (!this.pendingHarmony) {
        let progression = this.progression, step = this.progressionStep + 1, key = this.key;
        if (step >= progression.length) {
          progression = PROGRESSIONS[Math.floor(this.rng() * PROGRESSIONS.length)];
          step = 1; // The previous arc already arrived on vi.
          if (this.rng() < 0.25) key = pc(key + (this.rng() < 0.5 ? 7 : -7));
        }
        this.pendingHarmony = { chord: progression[step], key, progression, step };
      }
      const { chord, key, progression, step } = this.pendingHarmony;
      const nextChord = CHORDS[chord].tones.map(t => pc(t + key));
      // A change enters through tones compatible with the remaining decays.
      const available = new Set();
      for (let semi = -12; semi <= 24; semi++) {
        const freq = this.tone * Math.pow(2, semi / 12);
        if (freq >= 110 && freq <= 415.30 && nextChord.includes(pc(semi)) &&
            overlapWeight(semi, this.sounding, at, { id: null }, null, nextChord)) available.add(pc(semi));
      }
      if (available.size >= 2) {
        // A prepared bell can carry across a change, then resolve down by step
        // on that voice's own next entry (a suspension without metrical accents).
        const prepared = [...this.members.values()].find(m => !m.ending && m.lastSemi !== null &&
          m.lastChord.includes(pc(m.lastSemi)) && !nextChord.includes(pc(m.lastSemi)) &&
          this.sounding.some(n => n.kind === "bell" && n.performer === m.id && n.semi === m.lastSemi && n.until > at) &&
          [1, 2].some(step => nextChord.includes(pc(m.lastSemi - step))));
        if (prepared) {
          const step = [1, 2].find(n => nextChord.includes(pc(prepared.lastSemi - n)));
          const target = prepared.lastSemi - step;
          if (this.tone * Math.pow(2, target / 12) >= 110)
            prepared.resolution = { type: "suspension", target };
        }
        this.chord = chord;
        this.key = key;
        this.progression = progression;
        this.progressionStep = step;
        this.pendingHarmony = null;
        this.inversion = null;
        this.harmonyChanges++;
        this.harmonySerial++;
        this.nextHarmony = at + 65 + this.rng() * 55;
      } else {
        // Keep the intended progression and retry after the old harmony fades.
        this.nextHarmony = at + 8;
      }
    }
    chooseBass(chord, reserved) {
      const options = [];
      for (let semi = -18; semi <= 12; semi++) {
        const freq = this.tone * Math.pow(2, semi / 12), inversion = chord.indexOf(pc(semi));
        if (freq < 87.31 || freq > 174.62 || inversion < 0 || reserved.some(n => n.semi < semi) ||
            !compatible(semi, [...this.sounding, ...reserved], chord)) continue;
        const movement = this.lastBassSemi === null ? 0 : Math.abs(semi - this.lastBassSemi);
        options.push({ value: semi, weight: [1, 0.85, 0.65, 0.35][inversion] * Math.exp(-movement / 4) });
      }
      return options.length ? choose(options, this.bassRng) : null;
    }
    production(member, at, role, count) {
      // A separate random stream keeps production decisions out of melodic timing.
      const random = member.mixRng;
      if (member.panCenter === null) member.panCenter = role.pan;
      else member.panCenter += clamp(role.pan - member.panCenter, -0.18, 0.18);
      const panStart = clamp(member.panCenter + (random() - 0.5) * 0.035, -0.6, 0.6);
      const panEnd = clamp(panStart + (random() - 0.5) * 0.08, -0.6, 0.6);
      // Keep contrast across successive entries, and include the tails of voices
      // that have finished/left. This is a planning estimate, not microphone input.
      const peers = [...this.members.values()].filter(m => m.id !== member.id && !m.ending)
        .map(m => m.brightness ?? 0);
      const tails = this.sounding.filter(n => n.performer !== member.id && n.kind === "bell")
        .map(n => (n.brightness || 0) * Math.exp(-Math.max(0, at - n.at) / (n.duration * 0.45)));
      const brightest = Math.max(0, ...peers, ...tails);
      const brightness = Math.min(0.26 + random() * 0.52, clamp(0.98 - brightest, 0.18, 0.78));
      member.brightness = brightness;
      const audible = new Set([...this.members.values()].filter(m => !m.ending).map(m => m.id));
      for (const note of this.sounding)
        if (note.kind === "bell" && at - note.at < note.duration * 0.5) audible.add(note.performer);
      return { production: { panStart, panEnd, brightness },
        volume: 0.4 / Math.sqrt(Math.max(count, audible.size)) * (1 - 0.12 * brightness) *
          Math.min(1, Math.sqrt(member.period / 7.5)) };
    }
    makeEvent(member, at) {
      this.sounding = this.sounding.filter(n => n.until > at);
      this.harmony(at);
      const roles = this.roles();
      const count = roles.size;
      const role = roles.get(member.id);
      const chord = CHORDS[this.chord].tones.map(n => pc(n + this.key));
      const scale = [...new Set([...SCALE.map(n => pc(n + this.key)), ...chord])];
      let resolution = member.resolution;
      if (!resolution && member.lastSemi !== null && member.lastKey === this.key &&
          !chord.includes(pc(member.lastSemi)) && pc(member.lastSemi + 1) === chord[0] &&
          this.tone * Math.pow(2, (member.lastSemi + 1) / 12) <= 415.30)
        resolution = { type: "leading-tone", target: member.lastSemi + 1 };
      member.resolution = resolution;
      // Later entries must leave room for an already promised resolution.
      const reserved = [...this.members.values()].filter(m => m.id !== member.id && m.resolution)
        .map(m => ({ semi: m.resolution.target }));
      const wantsEnd = at >= member.deadline && !resolution;
      const activeBass = this.sounding.find(n => n.kind === "bass");
      const newBass = !activeBass && this.bassHarmony !== this.harmonySerial && !resolution && !wantsEnd
        ? this.chooseBass(chord, reserved) : null;
      const bassSemi = activeBass?.semi ?? newBass;
      const phraseEnd = member.step % 8 >= 6;
      const direction = member.rng() < 0.5 ? -1 : 1;
      let target = member.lastSemi;
      if (target !== null) {
        // Independent contours occasionally answer the other voice's last gesture.
        const reply = this.previous && this.previous.performer !== member.id && member.rng() < 0.35;
        target += reply ? -Math.sign(this.previous.delta) * 2 : direction * (member.rng() < 0.7 ? 2 : 4);
      }
      let candidates = [];
      for (let semi = -12; semi <= 24; semi++) {
        const freq = this.tone * Math.pow(2, semi / 12);
        if (freq < 110 || freq > 415.30 || (bassSemi !== null && semi < bassSemi) ||
            !scale.includes(pc(semi)) || !compatible(semi, reserved, chord)) continue;
        if (newBass !== null && !compatible(semi, [{ semi: newBass }], chord)) continue;
        const overlap = overlapWeight(semi, this.sounding, at, member, resolution, chord);
        if (!overlap) continue;
        if (resolution && semi !== resolution.target) continue;
        if (wantsEnd && ![chord[0], chord[2]].includes(pc(semi))) continue;
        const distance = target === null ? 0 : Math.abs(semi - target);
        const register = Math.abs(12 * Math.log2(freq / role.center));
        const isChord = chord.includes(pc(semi));
        if (!isChord) continue; // Non-chord departures are deliberately prepared below.
        let weight = Math.exp(-distance / 5) * Math.exp(-register / (count === 1 ? 14 : 5));
        weight *= overlap * voiceLeadingWeight(member, semi, this.members.values(), chord, member.lastHarmony !== this.harmonySerial);
        weight *= isChord ? (phraseEnd || wantsEnd ? 8 : 3) : 0.8;
        if (chord.length === 4 && [chord[1], chord[3]].includes(pc(semi))) weight *= 2;
        if (this.sounding.some(n => n.performer !== member.id && n.kind === "bell" &&
            pc(n.semi) === pc(semi) && at - n.at < n.duration * 0.5)) weight *= 0.4;
        if (semi === member.lastSemi) weight *= 0.55;
        candidates.push({ value: { semi, freq }, weight });
      }
      if (!resolution && !wantsEnd && member.lastHarmony === this.harmonySerial &&
          member.step >= member.ornamentAfter && ![...this.members.values()].some(m => m.resolution) && member.rng() < 0.18) {
        const ornaments = ornamentsFrom(member.lastSemi, chord, scale, this.tone).filter(o =>
          (bassSemi === null || (o.semi >= bassSemi && o.target >= bassSemi)) && compatible(o.semi, reserved, chord) &&
          (newBass === null || compatible(newBass, [{ semi: o.semi }, { semi: o.target }], chord)) &&
          overlapWeight(o.semi, this.sounding, at, member, o, chord));
        if (ornaments.length) candidates = ornaments.map(ornament => ({ weight: 1, value: {
          semi: ornament.semi, freq: this.tone * Math.pow(2, ornament.semi / 12), ornament
        } }));
      }
      if (!candidates.length) return null; // Silence is preferable to forcing a clash.
      const { semi, freq, ornament } = choose(candidates, member.rng);
      const delta = member.lastSemi === null ? 0 : semi - member.lastSemi;
      const tension = chord.includes(pc(semi)) ? (pc(semi) === chord[3] ? 0.24 : 0.12) : 0.45;
      const duration = wantsEnd ? 25 : Math.min(18 + member.rng() * 10, Math.max(9, member.period * 2.5));
      const mix = this.production(member, at, role, count);
      const notes = [{ kind: "bell", freq, duration,
        ...mix, tension, instability: 0.12 }];
      // A shared bass entry establishes the inversion of each new harmony.
      if (newBass !== null) {
        notes.push({ kind: "bass", freq: this.tone * Math.pow(2, newBass / 12),
          duration: 28, volume: 0.09, tension: 0, instability: 0,
          production: { panStart: 0, panEnd: 0, brightness: 0.2 } });
        this.lastBassSemi = newBass;
        this.bassHarmony = this.harmonySerial;
        this.inversion = chord.indexOf(pc(newBass));
      }
      const event = { id: ++this.sequence, at, performer: member.id,
        seed: Math.floor(member.rng() * 4294967296), notes, ending: wantsEnd,
        harmony: CHORDS[this.chord].name, key: this.key, inversion: this.inversion,
        motion: ornament?.type || resolution?.type || (semi === member.lastSemi ? "common-tone" : "free") };
      for (const note of notes) this.sounding.push({
        semi: Math.round(12 * Math.log2(note.freq / this.tone)), kind: note.kind,
        performer: member.id, at, duration: note.duration, until: at + note.duration + TAIL,
        brightness: note.production.brightness
      });
      this.previous = { performer: member.id, delta };
      member.lastSemi = semi;
      member.lastDelta = delta;
      member.lastKey = this.key;
      member.lastChord = chord;
      member.lastHarmony = this.harmonySerial;
      member.peerPitches = new Map([...this.members.values()].map(m => [m.id, m.lastSemi]));
      member.resolution = ornament ? { type: `${ornament.type}-resolution`, target: ornament.target } : null;
      if (ornament) member.ornamentAfter = member.step + 4;
      member.step++;
      if (wantsEnd) { member.ending = true; member.endAt = at + duration + TAIL; }
      return event;
    }
    plan(now, horizon = now + 2.5) {
      const ended = [];
      for (const member of this.members.values()) {
        if (member.ending && member.endAt <= now) {
          ended.push(member.id);
          this.members.delete(member.id);
        } else if (!member.ending && member.nextAt < now + 0.25) {
          // Skip missed pulses after a stall, retaining the original phase.
          member.pulse = Math.ceil((now + 0.25 - member.phase) / member.period);
          member.nextAt = member.phase + member.pulse * member.period;
        }
      }
      const events = [];
      for (let guard = 0; guard < MAX_MEMBERS * 2; guard++) {
        const member = [...this.members.values()].filter(m => !m.ending && m.nextAt <= horizon)
          .sort((a, b) => a.nextAt - b.nextAt || a.id.localeCompare(b.id))[0];
        if (!member) break;
        const at = member.nextAt;
        // A harmonic rest skips a pulse; it never moves the following pulse.
        member.nextAt = member.phase + (++member.pulse) * member.period;
        this.attacks = this.attacks.filter(e => e.at > at - 60);
        // Eight uninterrupted clocks naturally fit this bound. This protects
        // against rapid stop/rejoin churn, without retiming any voice.
        if (this.attacks.length >= MAX_ATTACKS) continue;
        const event = this.makeEvent(member, at);
        if (event) {
          events.push(event);
          this.events.push(event);
          this.attacks.push({ at, performer: member.id });
        }
      }
      this.events = this.events.filter(e => e.at >= now - SCORE_SECONDS);
      return { events, ended };
    }
    snapshot(now) {
      const events = this.events.filter(e => e.at <= now && e.at >= now - SCORE_SECONDS);
      const origin = events[0]?.at || now;
      return { format: "open-modular", version: VERSION, seed: this.seed, tone: this.tone,
        events: events.map(({ at, ...e }) => ({ ...e, time: at - origin })) };
    }
  }

  function validateScore(input) {
    const fail = () => { throw Error("This is not a supported Open Modular score."); };
    const number = (n, min, max) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
    const seed = n => number(n, 0, 4294967295) && Number.isInteger(n);
    if (!input || input.format !== "open-modular" || ![1, 2, 3, VERSION].includes(input.version) ||
        !seed(input.seed) || !Number.isInteger(input.tone) || !number(input.tone, 110, 200) ||
        !Array.isArray(input.events) || !input.events.length ||
        input.events.length > (input.version >= 4 ? MAX_EVENTS : input.version === 3 ? 2048 : 512)) fail();
    let previous = -1;
    const attacks = [];
    const events = input.events.map((e, i) => {
      if (!e || !number(e.time, 0, SCORE_SECONDS) || e.time < previous || !seed(e.seed) ||
          typeof e.performer !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(e.performer) ||
          !Array.isArray(e.notes) || !e.notes.length || e.notes.length > 2) fail();
      previous = e.time;
      while (attacks.length && attacks[0] <= e.time - 60) attacks.shift();
      if (attacks.length >= (input.version >= 4 ? MAX_ATTACKS : input.version === 3 ? 64 : 15)) fail();
      attacks.push(e.time);
      const notes = e.notes.map((n, j) => {
        if (!n || n.kind !== (j === 0 ? "bell" : "bass") ||
            !number(n.freq, n.kind === "bell" ? 110 : 87.31, 415.30) ||
            !number(n.duration, 5, 40) || !number(n.volume, 0, 0.5) ||
            !number(n.tension, 0, 1) || !number(n.instability, 0, 1)) fail();
        const clean = { kind: n.kind, freq: n.freq, duration: n.duration, volume: n.volume,
          tension: n.tension, instability: n.instability };
        if (input.version >= 2) {
          const p = n.production;
          if (!p || !number(p.panStart, -0.6, 0.6) || !number(p.panEnd, -0.6, 0.6) ||
              !number(p.brightness, 0.18, 0.78) ||
              (n.kind === "bass" && (p.panStart !== 0 || p.panEnd !== 0))) fail();
          clean.production = { panStart: p.panStart, panEnd: p.panEnd, brightness: p.brightness };
        }
        return clean;
      });
      return { id: i + 1, time: e.time, seed: e.seed, performer: e.performer,
        ending: e.ending === true, notes };
    });
    return { format: "open-modular", version: input.version, seed: input.seed, tone: input.tone, events };
  }
  const api = { VERSION, MAX_MEMBERS, SCORE_SECONDS, MIN_BPM, MAX_BPM, MAX_ATTACKS, MAX_EVENTS, TAIL, CHORDS, PROGRESSIONS, clock, random,
    chordDissonanceAllowed, voiceLeadingWeight, overlapWeight, Ensemble, validateScore };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OpenModular = api;
})(globalThis);
