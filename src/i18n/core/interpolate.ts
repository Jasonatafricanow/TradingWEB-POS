const PLACEHOLDER_PATTERN = /\{([a-z][a-z0-9_]*)\}/gi;
export type InterpolationValue = string | number;

export function getPlaceholderNames(template: string): string[] {
  return Array.from(template.matchAll(PLACEHOLDER_PATTERN), (match) => match[1]);
}

export function interpolate(
  template: string,
  params: Readonly<Record<string, InterpolationValue>>,
): string {
  const declared = new Set(getPlaceholderNames(template));
  const missing = [...declared].filter((name) => !(name in params));
  const unexpected = Object.keys(params).filter((name) => !declared.has(name));
  if (missing.length) throw new Error(`Missing interpolation parameter: ${missing.join(', ')}`);
  if (unexpected.length) throw new Error(`Unexpected interpolation parameter: ${unexpected.join(', ')}`);
  return template.replace(PLACEHOLDER_PATTERN, (_placeholder, name: string) => String(params[name]));
}
