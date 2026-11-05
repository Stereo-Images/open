/* Open Modular — independent musical clocks, shared harmonic context.
 * Pure composition and score validation; used by the shared worker and tests.
 * This has its own score version and does not change solo engines 1 or 3. */
(function(root) {
  "use strict";
  const VERSION = 1;
  const MAX_MEMBERS = 8;
  const SCORE_SECONDS = 1800;
  const TAIL = 10.465;
  const SCALE = [0, 2, 4, 5, 7, 9, 11];
  const CHORDS = [
    { name: "I", tones: [0, 4, 7] }, { name: "IV", tones: [5, 9, 0] },
    { name: "V", tones: [7, 11, 2] }, { name: "vi", tones: [9, 0, 4] },
    { name: "ii", tones: [2, 5, 9] }
  ];
  const pc = n => ((n % 12) + 12) % 12;
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
  function compatible(semi, sounding) {
    return sounding.every(n => ![1, 6, 11].includes(pc(semi - n.semi)));
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

  function overlapWeight(semi, sounding, at, member, resolution) {
    let weight = 1;
    for (const old of sounding) {
      const interval = pc(semi - old.semi);
      if (![1, 6, 11].includes(interval)) continue;
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
      this.members = new Map();
      this.events = [];
      this.sounding = [];
      this.attacks = [];
      this.sequence = 0;
      this.chord = 0;
      this.key = 0;
      this.harmonyChanges = 0;
      this.harmonySerial = 0;
      this.nextHarmony = now + 75;
      this.previous = null;
    }
    join(id, { seed, length, now }) {
      if (this.members.has(id)) return;
      if (this.members.size >= MAX_MEMBERS) throw Error("This ensemble already has eight windows.");
      if (!["short", "long", "infinite"].includes(length)) throw Error("Choose Short, Long, or Infinite.");
      const rng = random(seed);
      const duration = length === "short" ? 60 : length === "long" ? 600 + Math.floor(rng() * 1201) : Infinity;
      const basePeriod = 7.5 + rng() * 8;
      this.members.set(id, {
        id, seed: seed >>> 0, length, rng, basePeriod,
        period: basePeriod * Math.pow(this.members.size + 1, 0.75),
        nextAt: now + 2.5 + rng() * 3, deadline: now + duration,
        step: 0, lastSemi: null, lastDelta: 0, lastKey: null, lastChord: [],
        lastHarmony: -1, peerPitches: new Map(), resolution: null, ending: false, endAt: Infinity
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
        name: playing.length === 1 ? "Solo" : i === 0 ? "Lower voice" : i === playing.length - 1 ? "Upper voice" : "Middle voice"
      }]));
    }
    state() {
      const roles = this.roles();
      return { tone: this.tone, seed: this.seed, harmony: CHORDS[this.chord].name,
        members: [...this.members.values()].map(m => ({ id: m.id, length: m.length,
          role: m.ending ? "Finishing" : roles.get(m.id).name, ending: m.ending })) };
    }
    harmony(at) {
      if (at < this.nextHarmony) return;
      if ([...this.members.values()].some(m => !m.ending && m.resolution)) {
        this.nextHarmony = at + 10;
        return;
      }
      const options = [0, 1, 2, 3, 4].filter(i => i !== this.chord);
      const chord = options[Math.floor(this.rng() * options.length)];
      let key = this.key;
      if (++this.harmonyChanges % 4 === 0 && this.rng() < 0.5)
        key = pc(key + (this.rng() < 0.5 ? 7 : -7));
      // A change enters through tones compatible with the remaining decays.
      if (CHORDS[chord].tones.filter(t => compatible(pc(t + key), this.sounding)).length >= 2) {
        const nextChord = CHORDS[chord].tones.map(t => pc(t + key));
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
        this.harmonySerial++;
      }
      this.nextHarmony = at + 65 + this.rng() * 55;
    }
    makeEvent(member, at) {
      this.sounding = this.sounding.filter(n => n.until > at);
      this.harmony(at);
      const roles = this.roles();
      const count = roles.size;
      const role = roles.get(member.id);
      const chord = CHORDS[this.chord].tones.map(n => pc(n + this.key));
      const scale = SCALE.map(n => pc(n + this.key));
      let resolution = member.resolution;
      if (!resolution && member.lastKey === this.key && pc(member.lastSemi) === pc(this.key + 11) &&
          chord.includes(this.key) && this.tone * Math.pow(2, (member.lastSemi + 1) / 12) <= 415.30)
        resolution = { type: "leading-tone", target: member.lastSemi + 1 };
      const wantsEnd = at >= member.deadline && !resolution;
      const phraseEnd = member.step % 8 >= 6;
      const direction = member.rng() < 0.5 ? -1 : 1;
      let target = member.lastSemi;
      if (target !== null) {
        // Independent contours occasionally answer the other voice's last gesture.
        const reply = this.previous && this.previous.performer !== member.id && member.rng() < 0.35;
        target += reply ? -Math.sign(this.previous.delta) * 2 : direction * (member.rng() < 0.7 ? 2 : 4);
      }
      const candidates = [];
      for (let semi = -12; semi <= 24; semi++) {
        const freq = this.tone * Math.pow(2, semi / 12);
        if (freq < 110 || freq > 415.30 || !scale.includes(pc(semi))) continue;
        const overlap = overlapWeight(semi, this.sounding, at, member, resolution);
        if (!overlap) continue;
        if (resolution && semi !== resolution.target) continue;
        if (wantsEnd && ![chord[0], chord[2]].includes(pc(semi))) continue;
        const distance = target === null ? 0 : Math.abs(semi - target);
        const register = Math.abs(12 * Math.log2(freq / role.center));
        const isChord = chord.includes(pc(semi));
        let weight = Math.exp(-distance / 5) * Math.exp(-register / (count === 1 ? 14 : 5));
        weight *= overlap * voiceLeadingWeight(member, semi, this.members.values(), chord, member.lastHarmony !== this.harmonySerial);
        weight *= isChord ? (phraseEnd || wantsEnd ? 8 : 3) : 0.8;
        if (semi === member.lastSemi) weight *= 0.55;
        candidates.push({ value: { semi, freq }, weight });
      }
      if (!candidates.length) return null; // Silence is preferable to forcing a clash.
      const { semi, freq } = choose(candidates, member.rng);
      const delta = member.lastSemi === null ? 0 : semi - member.lastSemi;
      const tension = chord.includes(pc(semi)) ? 0.12 : 0.45;
      const duration = wantsEnd ? 25 : 18 + member.rng() * 10;
      const notes = [{ kind: "bell", freq, duration,
        volume: 0.4 / (1 + 0.06 * (count - 1)), tension, instability: 0.12 }];
      // One shared bass layer: all windows see it when choosing later notes.
      if (member.step % 8 === 0 && !wantsEnd && member.rng() < 0.35 &&
          !this.sounding.some(n => n.kind === "bass")) {
        let bassSemi = chord[0] - 12;
        while (this.tone * Math.pow(2, bassSemi / 12) < 87.31) bassSemi += 12;
        if (compatible(bassSemi, [...this.sounding, { semi }])) {
          notes.push({ kind: "bass", freq: this.tone * Math.pow(2, bassSemi / 12),
            duration: 28, volume: 0.09, tension: 0, instability: 0 });
        }
      }
      const event = { id: ++this.sequence, at, performer: member.id,
        seed: Math.floor(member.rng() * 4294967296), notes, ending: wantsEnd,
        harmony: CHORDS[this.chord].name, key: this.key,
        motion: resolution?.type || (semi === member.lastSemi ? "common-tone" : "free") };
      for (const note of notes) this.sounding.push({
        semi: Math.round(12 * Math.log2(note.freq / this.tone)), kind: note.kind,
        performer: member.id, at, duration: note.duration, until: at + note.duration + TAIL
      });
      this.previous = { performer: member.id, delta };
      member.lastSemi = semi;
      member.lastDelta = delta;
      member.lastKey = this.key;
      member.lastChord = chord;
      member.lastHarmony = this.harmonySerial;
      member.peerPitches = new Map([...this.members.values()].map(m => [m.id, m.lastSemi]));
      member.resolution = null;
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
          // Sleep/throttling never causes a catch-up burst or clock convergence.
          member.nextAt = now + 2.5 + member.rng() * 3;
        }
      }
      const events = [];
      for (let guard = 0; guard < MAX_MEMBERS * 2; guard++) {
        const member = [...this.members.values()].filter(m => !m.ending && m.nextAt <= horizon)
          .sort((a, b) => a.nextAt - b.nextAt || a.id.localeCompare(b.id))[0];
        if (!member) break;
        const at = member.nextAt;
        this.attacks = this.attacks.filter(e => e.at > at - 60);
        if (this.attacks.length >= 15) {
          member.nextAt = this.attacks[0].at + 60.1 + member.rng();
          continue;
        }
        const event = this.makeEvent(member, at);
        if (event) {
          events.push(event);
          this.events.push(event);
          this.attacks.push({ at, performer: member.id });
        }
        const count = [...this.members.values()].filter(m => !m.ending).length || 1;
        const target = member.basePeriod * Math.pow(count, 0.75);
        member.period += (target - member.period) * 0.3;
        const breath = event && member.step % 8 === 0 ? 1.35 : 1;
        member.nextAt = at + member.period * (0.84 + member.rng() * 0.32) * breath;
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
    if (!input || input.format !== "open-modular" || input.version !== VERSION ||
        !seed(input.seed) || !Number.isInteger(input.tone) || !number(input.tone, 110, 200) ||
        !Array.isArray(input.events) || !input.events.length || input.events.length > 512) fail();
    let previous = -1;
    const attacks = [];
    const events = input.events.map((e, i) => {
      if (!e || !number(e.time, 0, SCORE_SECONDS) || e.time < previous || !seed(e.seed) ||
          typeof e.performer !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(e.performer) ||
          !Array.isArray(e.notes) || !e.notes.length || e.notes.length > 2) fail();
      previous = e.time;
      while (attacks.length && attacks[0] <= e.time - 60) attacks.shift();
      if (attacks.length >= 15) fail();
      attacks.push(e.time);
      const notes = e.notes.map((n, j) => {
        if (!n || n.kind !== (j === 0 ? "bell" : "bass") ||
            !number(n.freq, n.kind === "bell" ? 110 : 87.31, 415.30) ||
            !number(n.duration, 5, 40) || !number(n.volume, 0, 0.5) ||
            !number(n.tension, 0, 1) || !number(n.instability, 0, 1)) fail();
        return { kind: n.kind, freq: n.freq, duration: n.duration, volume: n.volume,
          tension: n.tension, instability: n.instability };
      });
      return { id: i + 1, time: e.time, seed: e.seed, performer: e.performer,
        ending: e.ending === true, notes };
    });
    return { format: "open-modular", version: VERSION, seed: input.seed, tone: input.tone, events };
  }
  const api = { VERSION, MAX_MEMBERS, SCORE_SECONDS, TAIL, clock, random,
    voiceLeadingWeight, overlapWeight, Ensemble, validateScore };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OpenModular = api;
})(globalThis);
