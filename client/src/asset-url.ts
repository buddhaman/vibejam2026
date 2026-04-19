function normalizedBaseUrl(): string {
  const raw = import.meta.env.BASE_URL || "/";
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

export function publicAssetUrl(path: string): string {
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return `${normalizedBaseUrl()}${cleanPath}`;
}
