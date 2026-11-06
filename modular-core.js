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
  const ALIGNMENT_WINDOW = 0.12;
  const ALIGNMENT_RELEASE = 0.24;
  const ALIGNMENT_COOLDOWN = 20;
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
  const scaleSemi = (index, key) => key + SCALE[((index % 7) + 7) % 7] + 12 * Math.floor(index / 7);
  function nearestScaleIndex(semi, key) {
    let best = -14;
    for (let i = -13; i <= 21; i++)
      if (Math.abs(scaleSemi(i, key) - semi) < Math.abs(scaleSemi(best, key) - semi)) best = i;
    return best;
  }
  // At a meeting, choose the next pitch using solo Open's one-degree walk
  // and register gravity. Phrases count pitch decisions, not repeated strikes.
  // This stream never reads another voice's contour or changes a pulse time.
  function melodicTarget(member, tone, key, center) {
    const rng = member.melodyRng, phraseStep = member.step % 16;
    if (phraseStep === 0 || !member.cadence) member.cadence = choose([
      { value: [6, 2], weight: 0.35 }, // evaded
      { value: [1, 4], weight: 0.28 }, // half
      { value: [3, 0], weight: 0.12 }, // plagal
      { value: [6, 5], weight: 0.18 }, // deceptive
      { value: [6, 0], weight: 0.07 }  // authentic, kept occasional
    ], rng);
    const anchor = member.lastSemi ?? 12 * Math.log2(center / tone);
    let index = nearestScaleIndex(anchor, key);
    const freq = tone * Math.pow(2, anchor / 12);
    const upChance = freq >= 415.30 * 0.8 ? 0.15 : freq <= 110 * 1.2 ? 0.85 : 0.5;
    index += rng() < upChance ? 1 : -1;
    if ((phraseStep === 14 && rng() < 0.7) || (phraseStep === 15 && rng() < 0.35)) {
      const degree = ((index % 7) + 7) % 7;
      let delta = member.cadence[phraseStep - 14] - degree;
      if (delta > 3) delta -= 7;
      if (delta < -3) delta += 7;
      index += delta;
    }
    // Fold into the bell range on scale tones, without chromatic floor clamps.
    while (tone * Math.pow(2, scaleSemi(index, key) / 12) > 415.30) index -= 7;
    while (tone * Math.pow(2, scaleSemi(index, key) / 12) < 110) index++;
    return scaleSemi(index, key);
  }
  function prominent(note, at) {
    return at < note.at + note.duration * (note.kind === "bell" ? 0.5 : 1);
  }
  function chordDissonanceAllowed(a, b, chord) {
    if (chord.length < 4 || !chord.includes(pc(a)) || !chord.includes(pc(b))) return false;
    const distance = Math.abs(a - b);
    // A chordal major seventh (or its compound inversion) is intentional color.
    // Keep adjacent semitones out of the low bell register; dominant tritones
    // are valid chord tones rather than blanket forbidden intervals.
    return ([1, 11].includes(pc(distance)) && distance >= 11) || pc(distance) === 6;
  }
  function scaleSeventhAllowed(a, b, scale) {
    return [1, 11].includes(pc(a - b)) && Math.abs(a - b) >= 11 && scale.includes(pc(a)) && scale.includes(pc(b));
  }
  function compatible(semi, sounding, chord = [], scale = []) {
    return sounding.every(n => ![1, 6, 11].includes(pc(semi - n.semi)) ||
      chordDissonanceAllowed(semi, n.semi, chord) || scaleSeventhAllowed(semi, n.semi, scale));
  }

  // These are preferences from tonal voice leading, not strict SATB rules.
  function voiceLeadingWeight(member, semi, peers, chord, harmonyChanged) {
    if (member.lastSemi === null) return 1;
    const movement = semi - member.lastSemi, distance = Math.abs(movement);
    let weight = distance <= 2 ? 1.5 : distance <= 4 ? 1.2 : distance <= 7 ? 0.8 : 0.4;
    if (harmonyChanged && movement === 0 && chord.includes(pc(semi)) && member.lastChord.includes(pc(semi))) weight *= 1.5;
    for (const peer of peers) {
      const before = member.peerPitches.get(peer.id);
      if (peer.id === member.id || before == null || peer.lastSemi == null) continue;
      const otherMovement = peer.lastSemi - before;
      if (movement && otherMovement && Math.sign(movement) !== Math.sign(otherMovement)) weight *= 1.15;
      else if ((!movement && otherMovement) || (movement && !otherMovement)) weight *= 1.05;
      const oldInterval = Math.abs(member.lastSemi - before) % 12;
      const newInterval = Math.abs(semi - peer.lastSemi) % 12;
      if (movement && otherMovement && Math.sign(movement) === Math.sign(otherMovement) &&
          oldInterval === newInterval && [0, 7].includes(newInterval)) weight *= 0.65;
      if ((member.lastSemi - before) * (semi - peer.lastSemi) < 0) weight *= 0.8;
    }
    return weight;
  }

  function overlapWeight(semi, sounding, at, member, resolution, chord = [], scale = []) {
    let weight = 1;
    for (const old of sounding) {
      // Faded tails no longer vote on the next melody note.
      if (!prominent(old, at)) continue;
      const interval = pc(semi - old.semi);
      if (![1, 6, 11].includes(interval)) continue;
      const spacedSeventh = scaleSeventhAllowed(semi, old.semi, scale);
      if (chordDissonanceAllowed(semi, old.semi, chord) || spacedSeventh) { weight *= 0.85; continue; }
      const age = at - old.at;
      // A voice may walk by step through its own decay. Other voices still
      // avoid an exposed adjacent semitone or unprepared tritone.
      const ownStep = (resolution || Math.abs(semi - member.lastSemi) <= 2) &&
        old.kind === "bell" && old.performer === member.id &&
        old.semi === member.lastSemi && age >= Math.min(4, old.duration * 0.25);
      if (!ownStep) return 0;
      weight *= 0.9;
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
      this.chord = this.rng() < 0.5 ? 0 : 3;
      this.key = 0;
      this.harmonySerial = 0;
      this.contacts = new Map();
      this.nextAlignmentChange = now;
      this.lastAlignment = null;
      this.lastBassSemi = null;
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
        melodyRng: random((seed ^ 0x4D454C) >>> 0), cadence: null,
        mixRng: random((seed ^ 0xC01A0B0) >>> 0), panCenter: null, brightness: null,
        nextAt: phase, deadline: now + duration,
        step: 0, lastSemi: null, lastKey: null, lastChord: [],
        lastHarmony: -1, peerPitches: new Map(), ending: false, endAt: Infinity
      });
    }
    leave(id, now) {
      this.members.delete(id);
      for (const [pair, ids] of this.contacts) if (ids.includes(id)) this.contacts.delete(pair);
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
        alignmentCount: this.harmonySerial,
        members: [...this.members.values()].map(m => ({ id: m.id, length: m.length,
          role: m.ending ? "Finishing" : roles.get(m.id).name, bpm: 60 / m.period,
          frequency: m.lastSemi === null ? null : this.tone * Math.pow(2, m.lastSemi / 12), ending: m.ending })) };
    }
    pitchPalette(chord = this.chord, key = this.key) {
      const tones = CHORDS[chord].tones.map(n => pc(n + key));
      return { chord: tones, scale: [...new Set([...SCALE.map(n => pc(n + key)), ...tones])] };
    }
    choosePitch(member, at, chord, key, held) {
      const { scale } = this.pitchPalette(chord, key);
      const tones = CHORDS[chord].tones.map(n => pc(n + key));
      const roles = this.roles(), role = roles.get(member.id);
      const target = melodicTarget(member, this.tone, key, role.center);
      const others = [...held].filter(([id, semi]) => id !== member.id && semi !== null)
        .map(([, semi]) => ({ semi }));
      const bass = this.sounding.find(n => n.kind === "bass" && n.until > at);
      const peers = [...this.members.values()].filter(m => m.id !== member.id && !m.ending &&
        this.sounding.some(n => n.performer === m.id && n.kind === "bell" && prominent(n, at)));
      const options = [];
      for (let semi = -12; semi <= 24; semi++) {
        const freq = this.tone * Math.pow(2, semi / 12);
        if (freq < 110 || freq > 415.30 || (bass && semi < bass.semi) ||
            !scale.includes(pc(semi)) || !compatible(semi, others, tones, scale)) continue;
        const overlap = overlapWeight(semi, this.sounding, at, member, null, tones, scale);
        if (!overlap) continue;
        const register = Math.abs(12 * Math.log2(freq / role.center));
        let weight = Math.exp(-Math.abs(semi - target) / 1.25) * Math.exp(-register / 18) * overlap;
        weight *= voiceLeadingWeight(member, semi, peers, tones, member.lastHarmony !== this.harmonySerial);
        if (tones.includes(pc(semi))) weight *= member.step % 16 >= 13 ? 1.5 : 1.1;
        if (semi === member.lastSemi) weight *= 0.7;
        options.push({ value: semi, weight });
      }
      if (!options.length) return null;
      return options.some(o => o.value === target) ? target : choose(options, member.rng);
    }
    releaseContacts(entries) {
      for (const [pair, ids] of this.contacts) {
        const members = ids.map(id => this.members.get(id));
        if (members.some(m => !m || m.ending)) { this.contacts.delete(pair); continue; }
        for (const entry of entries) {
          const index = ids.indexOf(entry.member.id);
          if (index < 0) continue;
          const peer = members[1 - index];
          const nearest = peer.phase + Math.round((entry.at - peer.phase) / peer.period) * peer.period;
          if (Math.abs(entry.at - nearest) > ALIGNMENT_RELEASE + 1e-7) this.contacts.delete(pair);
        }
      }
    }
    synchronize(entries) {
      // Only actual, accepted strikes qualify. Clock projections and skipped
      // pulses cannot change harmony. New voices first establish their note.
      const voices = entries.filter(e => e.member.lastSemi !== null);
      if (voices.length !== entries.length || voices.length < 2 ||
          voices.at(-1).at - voices[0].at > ALIGNMENT_WINDOW + 1e-7) return null;
      let fresh = false;
      for (let i = 0; i < voices.length; i++) for (let j = i + 1; j < voices.length; j++) {
        const ids = [voices[i].member.id, voices[j].member.id].sort(), pair = ids.join("|");
        if (!this.contacts.has(pair)) fresh = true;
        this.contacts.set(pair, ids);
      }
      const at = voices[0].at;
      if (!fresh || at < this.nextAlignmentChange) return null;
      this.sounding = this.sounding.filter(n => n.until > at);
      const participants = new Set(voices.map(e => e.member.id));
      const held = new Map([...this.members.values()].filter(m => !m.ending).map(m => [m.id, m.lastSemi]));
      const current = this.pitchPalette().chord;
      const fixed = [...held].filter(([id, semi]) => !participants.has(id) && semi !== null).map(([, semi]) => semi);
      const recent = this.events.filter(e => at - e.at < 45).map(e => pc(Math.round(12 * Math.log2(e.notes[0].freq / this.tone))));
      const keys = this.harmonySerial >= 2 && this.rng() < 0.12
        ? [this.key, pc(this.key + (this.rng() < 0.5 ? 7 : -7))] : [this.key];
      const options = keys.flatMap(key => CHORDS.map((c, chord) => {
        const palette = this.pitchPalette(chord, key);
        if (fixed.some(semi => !palette.scale.includes(pc(semi)))) return null;
        const shared = current.filter(n => palette.chord.includes(n)).length;
        const fit = recent.length ? recent.filter(n => palette.chord.includes(n)).length / recent.length : 0;
        const color = c.name.startsWith("V") ? 0.15 : c.tones.length === 4 ? 0.5 : 1;
        return { value: { chord, key }, weight: color * (1 + shared) * (1 + fit) *
          (chord === this.chord && key === this.key ? 2.5 : 1) };
      }).filter(Boolean));
      const next = choose(options, this.rng), pitches = new Map();
      for (const { member, at: strikeAt } of voices) {
        const semi = this.choosePitch(member, strikeAt, next.chord, next.key, held);
        if (semi === null) return null; // Keep the old voicing; wait for a fresh meeting.
        pitches.set(member.id, semi);
        held.set(member.id, semi);
      }
      const palette = this.pitchPalette(next.chord, next.key);
      const notes = [...held.values()].filter(n => n !== null).map(semi => ({ semi }));
      if (!notes.every(n => compatible(n.semi, notes, palette.chord, palette.scale))) return null;
      if (next.chord === this.chord && next.key === this.key &&
          voices.every(e => pitches.get(e.member.id) === e.member.lastSemi)) return null;
      this.chord = next.chord;
      this.key = next.key;
      this.inversion = null;
      this.nextAlignmentChange = at + ALIGNMENT_COOLDOWN;
      const bass = !this.sounding.some(n => n.kind === "bass") && this.bassRng() < 0.4
        ? this.chooseBass(palette.chord, notes, at) : null;
      const alignment = { id: ++this.harmonySerial, at, performers: [...participants], pitches, bass };
      this.lastAlignment = { id: alignment.id, at, performers: alignment.performers };
      return alignment;
    }
    chooseBass(chord, held, at = 0) {
      const options = [];
      for (let semi = -18; semi <= 12; semi++) {
        const freq = this.tone * Math.pow(2, semi / 12), inversion = chord.indexOf(pc(semi));
        if (freq < 87.31 || freq > 174.62 || inversion < 0 || held.some(n => n.semi < semi) ||
            !compatible(semi, [...this.sounding.filter(n => prominent(n, at)), ...held], chord)) continue;
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
    makeEvent(member, at, alignment = null) {
      this.sounding = this.sounding.filter(n => n.until > at);
      const roles = this.roles(), role = roles.get(member.id);
      const { chord } = this.pitchPalette();
      const previous = member.lastSemi;
      let semi = alignment?.pitches.get(member.id) ?? previous;
      if (semi === null) {
        const held = new Map([...this.members.values()].filter(m => !m.ending).map(m => [m.id, m.lastSemi]));
        if (alignment) for (const [id, pitch] of alignment.pitches) held.set(id, pitch);
        semi = this.choosePitch(member, at, this.chord, this.key, held);
      }
      if (semi === null) return null;
      const wantsEnd = at >= member.deadline;
      const duration = wantsEnd ? 25 : Math.min(18 + member.rng() * 10, Math.max(9, member.period * 2.5));
      const notes = [{ kind: "bell", freq: this.tone * Math.pow(2, semi / 12), duration,
        ...this.production(member, at, role, roles.size),
        tension: chord.includes(pc(semi)) ? (pc(semi) === chord[3] ? 0.24 : 0.12) : 0.25, instability: 0.12 }];
      // Bass may enter/change only at the same meeting as the bell pitches.
      if (alignment && alignment.bass !== null && alignment.performers[0] === member.id) {
        const bass = alignment.bass;
        notes.push({ kind: "bass", freq: this.tone * Math.pow(2, bass / 12),
          duration: 28, volume: 0.09, tension: 0, instability: 0,
          production: { panStart: 0, panEnd: 0, brightness: 0.2 } });
        this.lastBassSemi = bass;
        this.inversion = chord.indexOf(pc(bass));
      }
      const event = { id: ++this.sequence, at, performer: member.id,
        seed: Math.floor(member.rng() * 4294967296), notes, ending: wantsEnd,
        harmony: CHORDS[this.chord].name, key: this.key, inversion: this.inversion,
        motion: previous === null ? "enter" : semi === previous ? "hold" : "alignment" };
      if (alignment?.pitches.has(member.id)) event.alignment = {
        id: alignment.id, at: alignment.at, performers: alignment.performers
      };
      for (const note of notes) this.sounding.push({
        semi: Math.round(12 * Math.log2(note.freq / this.tone)), kind: note.kind,
        performer: member.id, at, duration: note.duration, until: at + note.duration + TAIL,
        brightness: note.production.brightness
      });
      member.lastSemi = semi;
      if (previous === null || alignment?.pitches.has(member.id)) {
        member.lastKey = this.key;
        member.lastChord = chord;
        member.lastHarmony = this.harmonySerial;
        member.peerPitches = new Map([...this.members.values()].map(m => [m.id, m.lastSemi]));
        member.step++;
      }
      // End on the held pitch, even if no further meeting occurs.
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
          for (const [pair, ids] of this.contacts) if (ids.includes(member.id)) this.contacts.delete(pair);
          member.pulse = Math.ceil((now + 0.25 - member.phase) / member.period);
          member.nextAt = member.phase + member.pulse * member.period;
        }
      }
      const events = [];
      for (let guard = 0; guard < MAX_MEMBERS * 2; guard++) {
        const upcoming = [...this.members.values()].filter(m => !m.ending)
          .sort((a, b) => a.nextAt - b.nextAt || a.id.localeCompare(b.id));
        if (!upcoming.length || upcoming[0].nextAt > horizon) break;
        const first = upcoming[0].nextAt;
        // Include the full 120 ms encounter even across the normal lookahead
        // boundary, without moving any timestamp or splitting a meeting in two.
        const group = upcoming.filter(m => m.nextAt - first <= ALIGNMENT_WINDOW + 1e-7)
          .map(member => ({ member, at: member.nextAt }));
        this.releaseContacts(group);
        const accepted = [];
        for (const entry of group) {
          const { member, at } = entry;
          member.nextAt = member.phase + (++member.pulse) * member.period;
          this.attacks = this.attacks.filter(e => e.at > at - 60);
          if (this.attacks.length + accepted.length < MAX_ATTACKS) accepted.push(entry);
        }
        const alignment = this.synchronize(accepted);
        for (const { member, at } of accepted) {
          const event = this.makeEvent(member, at, alignment);
          if (event) {
            events.push(event);
            this.events.push(event);
            this.attacks.push({ at, performer: member.id });
          }
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
  const api = { VERSION, MAX_MEMBERS, SCORE_SECONDS, MIN_BPM, MAX_BPM, MAX_ATTACKS, MAX_EVENTS, TAIL, CHORDS, ALIGNMENT_WINDOW, ALIGNMENT_RELEASE, ALIGNMENT_COOLDOWN, clock, random,
    melodicTarget, chordDissonanceAllowed, voiceLeadingWeight, overlapWeight, Ensemble, validateScore };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OpenModular = api;
})(globalThis);
