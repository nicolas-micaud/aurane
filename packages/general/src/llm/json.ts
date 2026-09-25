/** Pull the first JSON object out of a model answer, fences and prose included. */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in answer');
  return JSON.parse(cleaned.slice(start, end + 1));
}
