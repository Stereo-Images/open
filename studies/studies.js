(() => {
  "use strict";
  function play(filename) {
    document.getElementById('replayInput').value = filename;
    document.getElementById('revisit').open = true;
    document.getElementById('replayRun').click();
  }
  document.getElementById('playStudy').addEventListener('click', () => {
    const option = document.getElementById('batchSeed').selectedOptions[0];
    play(option.dataset.replay);
  });
  document.getElementById('playShortStudy').addEventListener('click', () => {
    play('open-run-0393ded7-mviswtcb-g3-200hz-short-44100sr-1792628825406.wav');
  });
})();
