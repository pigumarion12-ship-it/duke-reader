/* Narration sources are restricted to local files and this release only. */
(function (root, factory) {
  'use strict';
  const policy = factory();
  if (typeof module === 'object' && module.exports) module.exports = policy;
  else root.DukeAudioSource = policy;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const local = /^audio\/onyx-b\/ch[0-9]{2}-p[0-9]{3}\.96k\.mp3$/;
  const released = /^https:\/\/github\.com\/pigumarion12-ship-it\/duke-reader\/releases\/download\/duke-supplement-audio-20261013\/ch[0-9]{2}-p[0-9]{3}\.96k\.mp3$/;
  function isAllowedFile(value) {
    return typeof value === 'string' && value.length <= 256 &&
      !/\s/.test(value) && (local.test(value) || released.test(value));
  }
  function validateLibrary(library) {
    if (!library || !Array.isArray(library.chapters) || !library.chapters.length) throw new Error('Invalid audio library');
    for (const chapter of library.chapters) {
      if (!chapter || !Array.isArray(chapter.parts) || !chapter.parts.length ||
          !chapter.downloads || typeof chapter.downloads !== 'object' ||
          Object.keys(chapter.downloads).length !== 0) throw new Error('Invalid chapter audio');
      for (const part of chapter.parts) {
        const recording = part && part.audio && part.audio.onyx;
        if (!recording || !isAllowedFile(recording.file) ||
            !Number.isFinite(recording.duration) || recording.duration <= 0) throw new Error('Invalid narration source');
      }
    }
    return library;
  }
  return Object.freeze({ isAllowedFile, validateLibrary });
});
