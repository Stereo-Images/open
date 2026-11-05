/* Open Modular desktop interface. Sound starts only from an explicit click. */
(() => {
  "use strict";
  function initialize() {
    const $ = id => document.getElementById(id);
    const audio = window.OpenModularAudio;
    const { clock, validateScore } = window.OpenModular;
    const roomParam = new URLSearchParams(location.search).get("room") || "open";
    const room = /^[a-zA-Z0-9_-]{1,40}$/.test(roomParam) ? roomParam : "open";
    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 0 && /Macintosh/i.test(navigator.userAgent));
    let worker, id, ready = false, joined = false, joining = false, replaying = false;
    let disposed = false, revision = 0, lastReply = clock(), exporting = false, startingAudio = false;
    let ensemble = { members: [], notes: 0 }, loadedScore = null, requestId = 0;
    const pending = new Map();
    const listeners = [];
    const urls = new Map();
    function listen(target, type, fn) {
      target.addEventListener(type, fn);
      listeners.push(() => target.removeEventListener(type, fn));
    }
    const message = text => { $("windowStatus").textContent = text; };
    function update() {
      const busy = joined || joining || replaying;
      $("modularPlay").disabled = !ready || busy;
      $("modularStop").disabled = !busy;
      $("modularPlay").setAttribute("aria-pressed", String(joined || joining));
      $("modularPlay").classList.toggle("filled", joined || joining);
      $("modularTone").disabled = busy || ensemble.members.length > 0;
      $("modularLength").disabled = busy;
      $("addWindow").disabled = !ready;
      $("saveScore").disabled = !ready || !ensemble.notes;
      $("exportEnsemble").disabled = !ready || !ensemble.notes || exporting;
      $("replayScore").disabled = !loadedScore || busy;
      $("exportScore").disabled = !loadedScore || exporting;
      const count = ensemble.members.length;
      $("ensembleStatus").textContent = ready
        ? count ? `${count} ${count === 1 ? "voice" : "voices"} · ${ensemble.tone} Hz` : "Ready for a voice."
        : "Ensemble connection unavailable.";
      const me = ensemble.members.find(member => member.id === id);
      if (joined && me) message(me.ending ? "Your final note is ringing out." : `${me.role} · ${me.bpm.toFixed(1)} BPM · ${ensemble.harmony}`);
    }
    function post(data) { if (worker && !disposed) worker.port.postMessage(data); }
    function stop(text = "Stopped. Other voices continue.") {
      revision++;
      if (joined || joining) post({ type: "leave" });
      joined = joining = replaying = startingAudio = false;
      audio?.stop();
      message(text);
      update();
    }
    function fail(text) {
      stop(text);
      ready = false;
      for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(Error(text)); }
      pending.clear();
      update();
    }
    function requestScore() {
      return new Promise((resolve, reject) => {
        const request = ++requestId;
        const timer = setTimeout(() => { pending.delete(request); reject(Error("The ensemble did not respond. Try again.")); }, 5000);
        pending.set(request, { resolve, reject, timer });
        post({ type: "score", request });
      });
    }
    function downloadScore(score) {
      const url = URL.createObjectURL(new Blob([JSON.stringify(score)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `open-modular-${score.seed.toString(16).padStart(8, "0")}-${Date.now()}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      urls.set(url, setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 60000));
    }
    async function exportWav(getScore) {
      if (exporting) return;
      exporting = true;
      update();
      $("replayStatus").textContent = "Preparing ensemble WAV…";
      try { await audio.export(await getScore()); }
      catch (error) { $("replayStatus").textContent = `WAV export failed. ${error.message}`; }
      finally { exporting = false; if (!disposed) update(); }
    }
    listen($("modularPlay"), "click", async () => {
      if (!ready || joined || joining || replaying) return;
      const tone = Number($("modularTone").value);
      if (!Number.isInteger(tone) || tone < 110 || tone > 200) { message("Choose a root from 110 to 200 Hz."); return; }
      const request = ++revision;
      joining = true;
      startingAudio = true;
      message("Joining…");
      update();
      try {
        if (!await audio.start(crypto.getRandomValues(new Uint32Array(1))[0]) || request !== revision) return;
        post({ type: "join", tone, length: $("modularLength").value });
      } catch (error) { if (request === revision) stop(error.message); }
      finally { if (request === revision) startingAudio = false; }
    });
    listen($("modularStop"), "click", () => stop());
    listen($("addWindow"), "click", () => {
      const url = new URL("modular.html", location.href);
      url.searchParams.set("room", room);
      const popup = window.open(url.href, "_blank", "width=520,height=800,resizable=yes,scrollbars=yes");
      if (popup) { popup.opener = null; $("popupFallback").hidden = true; }
      else {
        $("popupFallback").href = url.href;
        $("popupFallback").hidden = false;
        message("The pop-up was blocked. Use the link below, then press Play there.");
      }
    });
    listen($("saveScore"), "click", async () => {
      try { downloadScore(await requestScore()); $("replayStatus").textContent = "Ensemble score saved."; }
      catch (error) { $("replayStatus").textContent = error.message; }
    });
    listen($("exportEnsemble"), "click", () => exportWav(requestScore));
    listen($("exportScore"), "click", () => exportWav(() => loadedScore));
    listen($("loadScore"), "change", async () => {
      const file = $("loadScore").files[0];
      loadedScore = null;
      update();
      if (!file) return;
      try {
        if (file.size > 4 * 1024 * 1024) throw Error("Choose an Open Modular score smaller than 4 MB.");
        const parsed = validateScore(JSON.parse(await file.text()));
        if (file !== $("loadScore").files[0] || disposed) return;
        loadedScore = parsed;
        $("loadedScoreStatus").textContent = `${parsed.events.length} events · ${new Set(parsed.events.map(e => e.performer)).size} voices · ${parsed.tone} Hz. Ready to play.`;
      } catch (error) { $("loadedScoreStatus").textContent = `Could not load score. ${error.message}`; }
      update();
    });
    listen($("replayScore"), "click", async () => {
      if (!loadedScore || joined || joining || replaying) return;
      const request = ++revision;
      replaying = true;
      startingAudio = true;
      update();
      try {
        if (await audio.replay(loadedScore) && request === revision) message("Playing the loaded ensemble in this window.");
      } catch (error) { if (request === revision) stop(error.message); }
      finally { if (request === revision) startingAudio = false; }
    });
    function connect() {
      if (worker) { worker.port.postMessage({ type: "disconnect" }); worker.port.close(); }
      ready = false;
      worker = new SharedWorker(new URL("modular-worker.js?v=modular-5", location.href), { name: `open-modular-5-${room}` });
      worker.onerror = () => fail("Modular could not connect. Reload this page to try again.");
      worker.port.onmessageerror = () => fail("The ensemble connection failed. Reload to try again.");
      worker.port.onmessage = ({ data }) => {
        if (disposed) return;
        lastReply = clock();
        switch (data.type) {
          case "ready": id = data.id; ready = true; update(); break;
          case "state":
            ensemble = data;
            if (data.members.length && !replaying) $("modularTone").value = data.tone;
            if (joined && !data.members.some(m => m.id === id)) stop("This voice has left. Press Play to rejoin.");
            update();
            break;
          case "joined":
            if (!joining) { post({ type: "leave" }); break; }
            joining = false;
            joined = true;
            ensemble = { ...ensemble, ...data };
            $("modularTone").value = data.tone;
            update();
            break;
          case "event":
            if (joined && data.event.performer === id && !audio.schedule(data.event))
              stop(audio.state().running ? "This window fell behind. Press Play to rejoin." : "Audio paused. Press Play to rejoin.");
            break;
          case "left":
            if (joined || joining) { joined = joining = false; audio.stop(); message(data.reason); update(); }
            break;
          case "score": {
            const request = pending.get(data.request);
            if (!request) break;
            clearTimeout(request.timer);
            pending.delete(data.request);
            try { request.resolve(validateScore(data.score)); }
            catch { request.reject(Error("No notes have played yet. Wait for the first bell.")); }
            break;
          }
          case "error": stop(data.message); break;
        }
      };
      worker.port.start();
      lastReply = clock();
    }
    const supported = audio && "SharedWorker" in window && !mobile && /^https?:$/.test(location.protocol);
    if (supported) {
      try { connect(); } catch { fail("Modular needs a desktop browser with shared-worker support. Solo Open is available below."); }
    } else {
      $("loadScore").disabled = mobile || !audio;
      message("Modular needs a supported desktop browser and an HTTP(S) page. Solo Open is available below.");
      update();
    }
    const heartbeat = setInterval(() => {
      if (disposed) return;
      if (ready) post({ type: "ping" });
      if (worker && ready && clock() - lastReply > 10) {
        fail("Connection paused. Reconnecting…");
        try { connect(); } catch { message("Reload this window to reconnect."); }
      }
      if (!startingAudio && (joined || replaying) && !audio.state().running) stop("Audio paused. Press Play to rejoin.");
      if (!startingAudio && replaying && !audio.state().playing) { replaying = false; message("Loaded score finished."); update(); }
    }, 1000);
    function dispose() {
      if (disposed) return;
      stop();
      post({ type: "disconnect" });
      disposed = true;
      clearInterval(heartbeat);
      worker?.port.close();
      for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(Error("Window closed.")); }
      pending.clear();
      for (const [url, timer] of urls) { clearTimeout(timer); URL.revokeObjectURL(url); }
      urls.clear();
      listeners.splice(0).forEach(remove => remove());
      window.__OPEN_PLAYER_KILL__?.();
    }
    listen(window, "pagehide", dispose);
    // A back/forward-cache return must create a fresh port and audio context.
    window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
