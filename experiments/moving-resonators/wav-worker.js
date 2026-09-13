"use strict";

// One worker per export; the main thread sends another chunk only after ready.
// Keep the existing 16-bit sample conversion, including its rounding behavior.
let format = null;
let framesWritten = 0;
let parts = [];

self.onmessage = ({ data }) => {
  try {
    if (data.type === "start") {
      if (format) throw new Error("Encoder already started");
      const { length, channels, sampleRate } = data;
      if (!Number.isInteger(length) || length < 1 ||
          !Number.isInteger(channels) || channels < 1 || channels > 32 ||
          !Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 384000 ||
          length * channels * 2 > 0xffffffff - 36) throw new Error("Invalid WAV format");
      format = { length, channels, sampleRate };
      const header = new ArrayBuffer(44);
      const view = new DataView(header);
      const bytes = length * channels * 2;
      view.setUint32(0, 0x46464952, true); // RIFF
      view.setUint32(4, bytes + 36, true);
      view.setUint32(8, 0x45564157, true); // WAVE
      view.setUint32(12, 0x20746d66, true); // fmt
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); // PCM
      view.setUint16(22, channels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * channels * 2, true);
      view.setUint16(32, channels * 2, true);
      view.setUint16(34, 16, true);
      view.setUint32(36, 0x61746164, true); // data
      view.setUint32(40, bytes, true);
      parts.push(new Blob([header]));
      self.postMessage({ type: "ready" });
      return;
    }
    if (data.type !== "samples" || !format || data.offset !== framesWritten ||
        !Array.isArray(data.channels) || data.channels.length !== format.channels) {
      throw new Error("Invalid WAV chunk order");
    }
    const count = data.channels[0].length;
    if (count < 1 || count > 65536 || framesWritten + count > format.length ||
        data.channels.some(ch => !(ch instanceof Float32Array) || ch.length !== count)) {
      throw new Error("Invalid WAV chunk size");
    }
    const pcm = new ArrayBuffer(count * format.channels * 2);
    const view = new DataView(pcm);
    let pos = 0;
    for (let frame = 0; frame < count; frame++) {
      for (const channel of data.channels) {
        let sample = Math.max(-1, Math.min(1, channel[frame]));
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
        view.setInt16(pos, sample, true);
        pos += 2;
      }
    }
    // Blob parts avoid a second contiguous allocation for the entire WAV.
    parts.push(new Blob([pcm]));
    framesWritten += count;
    if (framesWritten === format.length) {
      self.postMessage({ type: "done", blob: new Blob(parts, { type: "audio/wav" }) });
      parts = [];
      self.close();
    } else {
      self.postMessage({ type: "ready" });
    }
  } catch (error) {
    parts = [];
    self.postMessage({ type: "error", message: error.message });
    self.close();
  }
};
