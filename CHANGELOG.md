# Changelog

All notable changes to OSG are listed here. The project follows [Semantic Versioning](https://semver.org/).

## 0.1.0 – 2026-10-20

First public release.

- Local web app (`npm start`) with dashboard, shows & movies, translation wizard, job log, subtitle editor, glossary, history & costs, settings.
- Speech-to-text through OpenRouter (default `openai/whisper-large-v3`, fallback model, word timestamps, silence-aware chunking, hallucination filter).
- Translation through OpenRouter (default `google/gemini-3.1-flash-lite`) with audio clips for speaker gender, a per-show character sheet and glossary, structured output, validation, retries and batch splitting.
- Custom OpenAI-compatible endpoints for both steps (local Whisper servers, Ollama, LM Studio, vLLM, llama.cpp, Groq…), with presets, connection tests and “Reset to defaults”.
- Uses existing `.srt` files or embedded text subtitle tracks as the timing source.
- Output next to the video as `Episode.<lang>.srt`, UTF-8 with BOM, UTF-8, or legacy code pages with safe fallback; CRLF; NFC.
- Cost estimate before starting and real cost tracking per call, job, show and model.
