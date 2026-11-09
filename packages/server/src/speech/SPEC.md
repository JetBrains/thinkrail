---
id: submodule-server-speech
type: submodule-design
status: active
title: speech — on-demand local voice input (NVIDIA nemo-speech + Nemotron ASR)
parent: module-server
depends-on: [module-contracts, submodule-server-subprocess]
references: [submodule-server-persistence, architecture, submodule-web-speech]
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
- **Public surface (barrel):** `initSpeech`, `installSpeech`, `cancelSpeechInstall`, `stopSpeechInstall`, `removeSpeech`,
  `speechStatus`, `setSpeechPublisher`, `stopEngine`, `createSpeechRelay`, `SpeechRelay`,
  `SpeechClientSocket`.
- **Allowed deps:** `persistence` (`dataDir`), `subprocess` (the PATH probe and archive unpacking run
  bounded; the engine is supervised), `log`, `@thinkrail/contracts`, `@thinkrail/shared/codedError` and
  `/freePort`.
- **Forbidden:**
  - Deleting anything outside `<dataDir>/speech/`, which includes a PATH install.
  - Logging, persisting or reporting transcripts or audio.
  - Fetching anything not in the manifest.

## Install

- **`initSpeech()`**
  - Publishes what the disk already holds before its first await, so a welcome seed is never blank.
  - Then probes PATH and publishes again with disk usage.
- **PATH probe**
  - `Bun.which("nemo-speech")`, then `--version` (10 s) and `doctor --json` (30 s: it initializes every
    compute device, and Metal took 13 s on an idle Mac).
  - It runs once at boot. An install re-probes only when no PATH runtime was found, so a probe never
    delays the download.
  - It is compatible when it shares the pinned major.minor (0.x minors are breaking).
  - The backend is the first of cuda/metal/vulkan the doctor reports, else cpu.
  - A compatible PATH runtime wins over the managed copy.
- **`installSpeech(model)`**
  - Throws `SPEECH_UNSUPPORTED_PLATFORM` or `SPEECH_INSTALL_BUSY`. It is a no-op when that model is
    already ready. Otherwise it returns at once; progress and the outcome arrive on `speech.changed`,
    throttled to 200 ms.
  - It re-probes PATH if nothing was found at boot, then checks free space (`statfs`). The runtime counts ×4 for unpacking, the
    model counts minus its partial, plus 64 MiB of headroom. `SPEECH_DISK_SPACE` when short.
  - It downloads only what is missing:
    - **Runtime.** Verified first, then unpacked with the system `tar` (Windows uses
      `%SystemRoot%\System32\tar.exe`, never a Git-for-Windows tar from PATH, which can't read zip)
      into a fresh staging dir. The archive's root is renamed into place only if it holds the binary.
    - **Model.** Streamed into `models/<file>.partial`.
  - Then it writes the marker naming the new model, stops the engine, and only after that deletes the
    other model and its partial. Any engine started after the marker loads the new model, so nothing
    opens a file that is about to be deleted. Deleting it would fail on Windows while the file is open.
- **`downloadVerified(artifact, dest)`**
  - Resumes `${dest}.partial` with `Range: bytes=<n>-` and re-hashes the kept prefix. A `200` reply
    restarts from zero.
  - The file reaches `dest` only when size and SHA-256 match.
  - A network failure keeps the partial for the next attempt (`SPEECH_DOWNLOAD_FAILED`). A mismatch, or a
    body longer than pinned, deletes it (`SPEECH_CHECKSUM_MISMATCH`).
- **Outcomes.**
  - Cancelling (`speech.cancelInstall`) discards staging and partials and returns to what the disk
    holds. A host shutdown (`stopSpeechInstall`) aborts with its own reason and keeps them, so the next
    launch resumes like it would after a crash. Quitting mid-download used to restart the ~750 MB download.
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

## Engine

- **Start.** `ensureEngine(inputs)` starts `nemo-speech serve` lazily, on a dictation's start, through
  `subprocess`'s `spawnSupervised` (the same process-group and hidden-console rules as every host child):
  - `--host 127.0.0.1`, a free port chosen by the host (the CLI rejects `--port 0`), and a random
    per-launch `--api-key`, so a browser page can't use the loopback port (WebSockets skip CORS). The
    key is on the command line, so it doesn't hide the port from a local process that can read `ps`;
    that process already runs as a user on the host;
  - `--no-ui --asr-model <gguf>`.
  - It is ready once `GET /v1/models` answers with the key, within 120 s, which covers model load. An
    exit or timeout first becomes `engine: failed` / `SPEECH_ENGINE_FAILED`, with the last 500 bytes of
    stderr logged. The next dictation retries.
- **Reuse.** A launch is claimed synchronously, before any await, so concurrent dictations share one
  engine. The same runtime and model reuse it; different inputs (a model switch) shut the previous
  launch down first.
- **Stopping mid-start.** A loading child stays reachable. A stop or a replacing launch aborts the
  readiness wait and kills it at once: on POSIX the group signal precedes the first await, so the host's
  `void stopEngine()` just before `process.exit` still reaps it.
- **Idle stop.** `holdEngine()` counts live dictations. The engine stops 10 minutes after the last
  release, never while one is held.
- **Crash.** An unexpected exit reads as `stopped`, and the next dictation starts it again.
- **Orphans.**
  - On POSIX the engine runs with `exitWithParent`, so it dies with a killed or crashed host.
  - Windows has no such watchdog. There the host's pid and the engine's pid go to
    `<dataDir>/speech/engine.pid`, removed on a normal stop.
  - The next `initSpeech` reaps that engine only when its owning host is gone. A desktop app and a CLI
    sharing the data dir therefore never kill each other's live engine. The engine is checked by image
    name (`nemo-speech.exe`) through `tasklist`.
- **Shutdown.** `stopEngine()` (host `stop()`, install, removal) kills a running or starting engine and
  waits for the child's exit.
- **Fixture.** `fakeNemoSpeech.ts` stands in for the CLI in unit and e2e tests. It answers `--version`,
  `doctor` and `serve`, the realtime protocol emits one scripted word per 160 ms of audio, and an
  optional log file records each `session.update`.

## Relay

`createSpeechRelay(socket)` serves one `/speech` socket, with at most one dictation at a time (a second
`start` answers `SPEECH_BUSY`, and a malformed control message answers `SPEECH_PROTOCOL`).

1. **Start.**
   - `start` reads the installed inputs (`SPEECH_NOT_INSTALLED` without them), holds the engine, and
     opens the engine's realtime socket with `?api_key=`.
2. **While the engine starts**, up to 30 s of audio is buffered. Frames over 64 KiB, and frames past a
   4 MiB upstream buffer, are dropped.
3. **On upstream open** it sends `session.update` (`sample_rate 16000` and the model's language),
   flushes the buffer, and answers `ready`.
4. **Events.** The engine's `delta` events are appends; the relay accumulates them and sends each as a
   replacing `partial`. `completed` becomes a `final` and resets the partial.
5. **Stop.** `stop` sends `input_audio_buffer.commit`, or defers it until upstream opens. `committed`, or
   an 8 s timeout counted from the commit, never from the stop, ends the dictation. A cold engine may
   still be loading the model when the user stops.
   Ending flushes any uncompleted partial as a `final`, then sends `ended`, closes upstream and
   releases the hold, exactly once. An engine error or a lost upstream sends `SPEECH_ENGINE_FAILED` first.
6. **Language tags.** A trailing auto-detect language tag (`<en-US>`) is stripped from all text.

**No word boosting.** Dictation sends no `speech_contexts`. Biasing recognition toward the project's
names was built and then removed after measuring it against the real engine and model on synthesized
sentences:

| Boost list | Ordinary English | Spoken identifiers |
|---|---|---|
| 300 repo-wide file, folder, command and skill names at boost 3 | wrecked ("Please release-pi-packages.ymlen…") | wrong |
| 20 recently touched code identifiers at boost 2 | mostly intact, but "settings dialog" became "settingsNavlog" | "use app store" → `useAppStore` |
| 20 identifiers at boost 1.5 | intact | unchanged |

The user chose to try the product without it. A future version would be an opt-in setting, not a
default.

## Get right

- Size is checked at every boot, but the SHA-256 only once, at download. Re-hashing 740 MB on each start
  would delay the welcome seed.
- The marker is written only after every file it names is verified. A crash before that leaves no marker
  for the new model, so the host reports what was installed before and the retry resumes the partials.
- **Every engine failure reaches Error Tracking once, as a `CodedError` (`SPEECH_ENGINE_FAILED`).**
  `log.warn` reports only when given an error, and the first version logged bare messages. The likeliest
  field failure, an MDM or antivirus tool blocking NVIDIA's unsigned binary, was therefore invisible.
  - A failed start is reported by the engine, once per run, however many relays waited on it.
  - An unexpected exit is reported by the engine.
  - A mid-dictation break (upstream error or close, or an engine `error` event) is reported by the relay.
  - The stderr tail stays in the message, which is never sent.
  - A deliberate stop reports nothing: a cancelled start, `stopEngine`, or an engine that is no longer
    the live one (`isLiveEngine`).
