import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockOpenAI {
  url: string;
  requests: { path: string; auth: string | undefined; body: string; contentType: string }[];
  close: () => Promise<void>;
}

/**
 * A tiny OpenAI-compatible server (what Speaches / whisper.cpp / Ollama / LM Studio expose):
 * `GET /v1/models`, `POST /v1/audio/transcriptions` (multipart), `POST /v1/chat/completions`.
 * It rejects `json_schema` once to exercise OSG's structured-output fallback.
 */
export async function startMockOpenAI(
  opts: { apiKey?: string; rejectJsonSchema?: boolean } = {},
): Promise<MockOpenAI> {
  const requests: MockOpenAI['requests'] = [];
  let rejectedSchema = false;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('latin1');
      requests.push({
        path: req.url ?? '',
        auth: req.headers.authorization,
        body,
        contentType: req.headers['content-type'] ?? '',
      });
      const send = (status: number, json: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (opts.apiKey && req.headers.authorization !== `Bearer ${opts.apiKey}`)
        return send(401, { error: { message: 'invalid api key' } });
      if (req.url === '/v1/models')
        return send(200, { object: 'list', data: [{ id: 'whisper-local' }, { id: 'llm-local' }] });
      if (req.url === '/v1/audio/transcriptions') {
        const wantsWords = body.includes('timestamp_granularities[]') && body.includes('word');
        const segments = [0, 6, 12, 18].map((t, i) => ({
          id: i,
          start: t,
          end: t + 3.5,
          text: ` Local line ${i + 1}.`,
          no_speech_prob: 0.02,
          avg_logprob: -0.3,
        }));
        const words = wantsWords
          ? segments.flatMap((s, i) =>
              ['local', 'line', String(i + 1)].map((w, k) => ({
                word: w,
                start: s.start + k,
                end: s.start + k + 0.8,
              })),
            )
          : undefined;
        return send(200, {
          task: 'transcribe',
          language: 'english',
          duration: 24,
          text: segments.map((s) => s.text).join(''),
          segments,
          words,
        });
      }
      if (req.url === '/v1/chat/completions') {
        const json = JSON.parse(Buffer.from(body, 'latin1').toString('utf8')) as {
          response_format?: { type: string; json_schema?: { name: string } };
          messages: { role: string; content: string | { type: string; text?: string }[] }[];
        };
        if (opts.rejectJsonSchema && json.response_format?.type === 'json_schema') {
          rejectedSchema = true;
          return send(400, {
            error: { message: 'response_format json_schema is not supported by this server' },
          });
        }
        const user = json.messages.find((m) => m.role === 'user')!;
        const text =
          typeof user.content === 'string'
            ? user.content
            : (user.content.find((p) => p.type === 'text')?.text ?? '');
        let content: string;
        if (text.startsWith('Translate')) {
          content = JSON.stringify({ text: 'Dobro jutro, prijatelju.' });
        } else if (text.startsWith('Known glossary')) {
          content = JSON.stringify({ characters: [], formality: [], terms: [], style_notes: '' });
        } else {
          const payload = JSON.parse(text) as { cues: { id: number }[] };
          content = JSON.stringify({
            items: payload.cues.map((c) => ({
              id: c.id,
              speaker_gender: 'u',
              text: `Lokalni redak ${c.id} — žđčćš`,
            })),
          });
        }
        return send(200, {
          id: 'x',
          object: 'chat.completion',
          model: 'llm-local',
          choices: [{ index: 0, message: { role: 'assistant', content } }],
          usage: { prompt_tokens: 50, completion_tokens: 20 },
        });
      }
      send(404, { error: 'not found' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    get rejected() {
      return rejectedSchema;
    },
    close: () => new Promise((r) => server.close(() => r())),
  } as MockOpenAI;
}
