// Tokenize serialized JSON for display only. React escapes every token; no HTML
// injection, parsing of generated code, or syntax-highlighting dependency.
export function JsonCode({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2) ?? 'null';
  const parts = text.split(/("(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g);
  return parts.map((part, index) => {
    if (index % 2 === 0) return part;
    const kind = part.startsWith('"')
      ? parts[index + 1]?.trimStart().startsWith(':') ? 'key' : 'string'
      : /^(true|false|null)$/.test(part) ? 'literal' : 'number';
    return <span className={`json-${kind}`} key={index}>{part}</span>;
  });
}
