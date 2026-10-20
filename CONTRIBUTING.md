# Contributing to OSG

Thanks for helping! Bug reports, translations of the UI copy, better prompts, new providers and fixes are all welcome.

## Getting started

1. Install Node.js 22 or newer.
2. Fork and clone the repository, then run `npm install`.
3. Start the dev servers with `npm run dev` and open http://localhost:5173.

The API server restarts on changes in `src/server`, and the web UI hot-reloads. Your settings and history live in a separate data folder, so you can point a dev instance at a throw-away folder with `OSG_DATA_DIR=/tmp/osg-dev npm run dev`.

## Before you open a pull request

```bash
npm run lint
```

```bash
npm run typecheck
```

```bash
npm test
```

- Keep pull requests focused on one change and describe how you tested it.
- Add or update tests for behaviour changes. The test suite never calls paid APIs: use the fakes in `tests/helpers/fakes.ts` or the mock OpenAI-compatible server in `tests/helpers/mock-openai.ts`. Video fixtures are generated with ffmpeg in `tests/helpers/fixtures.ts`, so no media files are committed.
- If you change `src/server/db/schema.ts`, run `npm run db:generate` and commit the new migration.
- UI copy is sentence case, plain and specific. Name actions by what they do (“Save subtitle file”, not “Submit”), and say how to fix an error.
- Use [Conventional Commits](https://www.conventionalcommits.org) for commit messages, e.g. `feat: add WebVTT export` or `fix(srt): keep dialogue dashes when wrapping`.

## Project layout

- `src/server/services` holds the pipeline. Each stage is a small module with pure, testable helpers (`cues.ts`, `chunker.ts`, `srt.ts`, `translate.ts`…) and `pipeline.ts` wires them together.
- `src/server/providers` contains the adapters. To support another API, implement `SttProvider` or `ChatProvider` from `types.ts`; most local servers already work through `openai-compatible.ts`.
- `src/shared` has the zod schemas and types shared by server and web, plus the language list (`languages.ts`). Adding a language there makes it available everywhere, including its legacy code page.
- `src/web` is the React app. Components follow the shadcn/ui pattern on top of Radix primitives, styled with the tokens in `src/web/styles.css`.

## Reporting bugs

Open an issue with what you did, what you expected and what happened. The job page has a **Copy** button for the log; please paste it (remove anything private). Mention your OS, Node.js version, the providers and models, and the video format.

## Security

If you find a security problem (for example a way for a website to reach the local API), please do not open a public issue. Use GitHub's private vulnerability reporting on the repository instead.

## License

By contributing you agree that your contributions are licensed under the MIT License.
