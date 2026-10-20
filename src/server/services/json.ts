/** Parses model output as JSON, tolerating code fences and leading/trailing prose. */
export function parseModelJson(raw: string): unknown {
  const text = raw.trim();
  try {
    return JSON.parse(text);
  } catch {
    // fall through
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through
    }
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) {
    return JSON.parse(text.slice(first, last + 1));
  }
  throw new SyntaxError('Model did not return JSON');
}
