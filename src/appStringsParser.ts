export function parseAppStrings(content: string): Record<string, string> {
  const strings: Record<string, string> = {};
  // Swift: static let key = "value"
  // Regex to capture: key and value
  // It handles various whitespace and ensures the line starts with static let and ends with a quote and optional semicolon.
  const regex = /^\s*static\s+let\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"((?:\\"|[^"])*)"\s*;?/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    strings[match[1]] = match[2].replace(/\\"/g, '"'); // Unescape quotes within the string
  }
  return strings;
} 