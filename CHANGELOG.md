# Changelog

All notable changes to OSG are listed here. The project follows [Semantic Versioning](https://semver.org/).

## Unreleased

- New file-name option **Both** (`Episode.hr.srt` + `Episode.srt`) for TVs that only load a subtitle with exactly the video's name (Samsung, LG…). **Save subtitle files…** rewrites selected episodes in another name or encoding without translating again; files OSG wrote under the old name are replaced, and deleting removes every file a job wrote.
- Default speech-to-text model is now `qwen/qwen3-asr-1.7b` (same price as Whisper, far fewer invented lines over music and noise); `openai/whisper-large-v3` is the fallback. Language names returned by the model ("english") are normalised to ISO codes.
- Much fewer invented lines from speech-to-text: music/sound-tag-only lines, multilingual credit lines and clusters of stock phrases (“Thank you.”, “Bye.”, “Merci.”) are removed, and the translation model drops short lines it cannot hear in the audio. On a music-heavy episode this cut invented lines from 134 to 58 in the first 16 minutes before audio verification.
- 4 jobs run at the same time by default (1–8), adjustable right in the dashboard queue; changes apply immediately.
- Open tabs recover after a server restart (reload with the new session token, reconnect live updates, “Reconnecting…” indicator).
- Transcription logs when it starts and how many chunks run in parallel.
- Delete subtitles from an episode's menu, for several selected episodes, or from the job page. Only the `.srt` OSG wrote is deleted; the translation can be kept in OSG.
- Search in the file browser: filter the current folder instantly, or include subfolders (case- and accent-insensitive).
- Jobs now prepare the audio before the character pass, so the log follows the stage timeline, and translation logs its progress batch by batch.
- The timeline names what replaced transcription (“Subtitle track” or “Existing .srt”).
- Install no longer runs dependency install scripts, so no compiler is needed on any platform (fixes `npm install` on Windows with Node 22); ffmpeg is downloaded on first start.
- OSG's own subtitle files are no longer offered as existing subtitles or used as the timing source.

## 0.1.0 – 2026-10-20

First public release.

- Local web app (`npm start`) with dashboard, shows & movies, translation wizard, job log, subtitle editor, glossary, history & costs, settings.
- Speech-to-text through OpenRouter (default `openai/whisper-large-v3`, fallback model, word timestamps, silence-aware chunking, hallucination filter).
- Translation through OpenRouter (default `google/gemini-3.1-flash-lite`) with audio clips for speaker gender, a per-show character sheet and glossary, structured output, validation, retries and batch splitting.
- Custom OpenAI-compatible endpoints for both steps (local Whisper servers, Ollama, LM Studio, vLLM, llama.cpp, Groq…), with presets, connection tests and “Reset to defaults”.
- Uses existing `.srt` files or embedded text subtitle tracks as the timing source.
- Output next to the video as `Episode.<lang>.srt`, UTF-8 with BOM, UTF-8, or legacy code pages with safe fallback; CRLF; NFC.
- Cost estimate before starting and real cost tracking per call, job, show and model.
