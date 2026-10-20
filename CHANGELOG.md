# Changelog

All notable changes to OSG are listed here. The project follows [Semantic Versioning](https://semver.org/).

## Unreleased

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
