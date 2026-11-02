---
id: submodule-server-speech
type: submodule-design
status: active
title: speech — on-demand local voice input (NVIDIA nemo-speech + Nemotron ASR)
parent: module-server
depends-on: [module-contracts, submodule-server-subprocess]
references: [submodule-server-persistence]
tags: [speech, voice, public-surface-checked]
---

## Responsibility

Voice input that runs entirely on the host:

- Installs NVIDIA's `nemo-speech` runtime and a Nemotron streaming ASR model on demand, both pinned and
  checksum-verified.
- Reuses a compatible `nemo-speech` the user already has on PATH.
- Reports the state as one `SpeechStatus` ([[module-contracts]] § Voice input).

Nothing ships with ThinkRail. The user chose a download on first use over bundling the runtime, and
accepted that NVIDIA's binaries are not signed by ThinkRail: the macOS build is ad-hoc signed and not
notarized, and the Windows build is unsigned. They run because a file ThinkRail's own process writes is
never quarantined. Where MDM or Defender blocks them anyway, the engine reports `SPEECH_ENGINE_FAILED`.

## Boundary

- **Owns:**
  - The pinned manifest (`manifest.ts`): the runtime version, one archive per target with its
    SHA-256 from NVIDIA's `SHA256SUMS`, and both models pinned to a Hugging Face revision with their
    LFS SHA-256. Windows on Arm uses the x64 build; any other platform is `supported: false`.
  - The layout under `<dataDir>/speech/`: `runtime/<version>-<target>/`, `models/<file>`,
    `.staging/`, and the `installed.json` marker, written last.
  - The install state machine.
  - The status store and its publisher.
- **Public surface (barrel):** `initSpeech`, `installSpeech`, `cancelSpeechInstall`, `removeSpeech`,
  `speechStatus`, `setSpeechPublisher`, `stopEngine`.
- **Allowed deps:** `persistence` (`dataDir`), `subprocess` (the PATH probe and archive unpacking run
  bounded), `log`, `@thinkrail/contracts`, `@thinkrail/shared/codedError`.
- **Forbidden:**
  - Deleting anything outside `<dataDir>/speech/`, which includes a PATH install.
  - Logging, persisting or reporting transcripts or audio.
  - Fetching anything not in the manifest.

## Install

- **`initSpeech()`**
  - Publishes what the disk already holds before its first await, so a welcome seed is never blank.
  - Then probes PATH and publishes again with disk usage.
- **PATH probe**
  - `Bun.which("nemo-speech")`, then `--version` and `doctor --json`, each under a 10 s budget.
  - It is compatible when it shares the pinned major.minor (0.x minors are breaking).
  - The backend is the first of cuda/metal/vulkan the doctor reports, else cpu.
  - A compatible PATH runtime wins over the managed copy.
- **`installSpeech(model)`**
  - Throws `SPEECH_UNSUPPORTED_PLATFORM` or `SPEECH_INSTALL_BUSY`. It is a no-op when that model is
    already ready. Otherwise it returns at once; progress and the outcome arrive on `speech.changed`,
    throttled to 200 ms.
  - It re-probes PATH, then checks free space (`statfs`). The runtime counts ×4 for unpacking, the
    model counts minus its partial, plus 64 MiB of headroom. `SPEECH_DISK_SPACE` when short.
  - It downloads only what is missing:
    - **Runtime.** Verified first, then unpacked with the system `tar` (Windows uses
      `%SystemRoot%\System32\tar.exe`, never a Git-for-Windows tar from PATH, which can't read zip)
      into a fresh staging dir. The archive's root is renamed into place only if it holds the binary.
    - **Model.** Streamed into `models/<file>.partial`.
  - Then it stops the engine, deletes the other model, and writes the marker.
- **`downloadVerified(artifact, dest)`**
  - Resumes `${dest}.partial` with `Range: bytes=<n>-` and re-hashes the kept prefix. A `200` reply
    restarts from zero.
  - The file reaches `dest` only when size and SHA-256 match.
  - A network failure keeps the partial for the next attempt (`SPEECH_DOWNLOAD_FAILED`). A mismatch, or a
    body longer than pinned, deletes it (`SPEECH_CHECKSUM_MISMATCH`).
- **Outcomes.**
  - Cancelling discards staging and partials and returns to what the disk holds.
  - A failure becomes `install: failed {model, code, usable}`; any uncoded error reads as
    `SPEECH_DOWNLOAD_FAILED`. `usable` names a previously installed model that still works, so a failed
    switch never disables dictation. The engine's inputs are read from the disk, not the status. A
    retry resumes.
  - A successful install deletes the other model and that model's stale partial.
- **Ready** means the marker's model file has its pinned size and a runtime (PATH or managed) exists.
- **`removeSpeech()`** cancels, waits for the install task, stops the engine, and deletes
  `<dataDir>/speech/`.
- **Test seam.** `THINKRAIL_SPEECH_MANIFEST` names a JSON file that replaces the pinned manifest,
  validated strictly (closed targets and models, safe file names, 64-hex SHA-256), so e2e can serve tiny
  fixtures.

## Get right

- Size is checked at every boot, but the SHA-256 only once, at download. Re-hashing 740 MB on each start
  would delay the welcome seed.
- The marker is the last write. A crash mid-install leaves no marker, so the host reports `not-installed`
  and the retry resumes the partials.
