/**
 * Search results and fetched pages read from what an MCP search service returns. Such services answer in text written
 * for models rather than in a schema: Exa and Tavily both write one labelled record per page (`Title:`, `URL:`, then
 * the text under `Highlights:`, `Content:` or `Raw Content:`), Exa's page reader heads each page with `# title`, and
 * other services send `structuredContent` or Markdown links. One reader takes all of them, so an administrator never
 * says which format a service uses. Everything here is the service's data: only http(s) addresses are kept.
 */

/** Tavily refuses longer queries, so every route is sent at most this many characters. */
export const WEB_SEARCH_QUERY_MAX = 400;

export type WebSearchResult = {
  title: string;
  url: string;
  content: string;
  /** As the service wrote it, when it gave one. */
  publishedAt?: string;
};

/** One page read from the web; `content` is its text. */
export type WebPage = WebSearchResult;

/** A tool result as the router hands it over: its text blocks, and the structured result when the service sent one. */
export type WebToolOutput = { text: string; structured?: unknown };

type Draft = {
  title?: string;
  url?: string;
  published?: string;
  /** A search snippet: highlights, a summary or a result's content. */
  snippet: string[];
  /** The page itself: raw content, or a page reader's text. */
  body: string[];
  into?: 'snippet' | 'body';
};

const RECORD_FIELDS = new Set(['Title', 'ID', 'URL']);
const SNIPPET_LABELS = new Set(['Highlights', 'Content', 'Text', 'Summary', 'Snippet']);
const LABEL = /^(Title|ID|URL|Published(?: [Dd]ate)?|Author|Favicon|Score|Highlights|Content|Text|Summary|Snippet|Raw Content):(?:[ \t]+(.*))?$/u;
/** A service's way of saying it found nothing, which is not a page's text. */
const NOTHING_FOUND = /^No (?:search results|results|content) found\b/iu;

function field(line: string) {
  const match = LABEL.exec(line);
  return match ? { name: match[1].startsWith('Published') ? 'Published' : match[1], value: (match[2] ?? '').trim() } : null;
}

const blank = (line: string | undefined) => line === undefined || !line.trim();

/** The index of the next line with text after `index`, or -1. */
function nextFilled(lines: readonly string[], index: number) {
  for (let next = index + 1; next < lines.length; next++) if (lines[next].trim()) return next;
  return -1;
}

/** `# title` directly above a `URL:` line heads a page, as Exa's page reader writes them. */
function heading(lines: readonly string[], index: number) {
  const match = /^# (.+)$/u.exec(lines[index]);
  return match && /^URL: /u.test(lines[index + 1] ?? '') ? match[1].trim() : null;
}

/** A record's address comes within two lines of its title (Tavily puts an `ID:` between them). */
function addressFollows(lines: readonly string[], index: number) {
  return lines.slice(index + 1, index + 3).some((line) => /^URL: /u.test(line));
}

/** Whether the line at `index` opens a record even inside another record's text. */
function opensRecord(lines: readonly string[], index: number) {
  const name = heading(lines, index) !== null ? 'Title' : field(lines[index] ?? '')?.name;
  return name === 'URL' || ((name === 'Title' || name === 'ID') && addressFollows(lines, index));
}

/**
 * Labelled records. A record starts at `Title:`, `ID:`, `URL:` or a page heading once the current one has its address.
 * Inside a record's text such a line starts the next record only after an empty line and with an address right
 * below, so a page that quotes a label keeps its text. Exa separates records with `---` between empty lines, Tavily
 * with an empty line; Tavily's image list and Exa's notes and per-address errors are not records.
 */
function labelledRecords(text: string): Draft[] {
  const lines = text.replace(/\r\n?/gu, '\n').split('\n');
  const records: Draft[] = [];
  let current: Draft | undefined;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const afterBlank = blank(lines[index - 1]);
    const ahead = nextFilled(lines, index);
    if (afterBlank && line.trim() === 'Images:' && (ahead < 0 || /^\[\d+\] URL: /u.test(lines[ahead]))) break;
    if (afterBlank && line.trim() === '---' && blank(lines[index + 1]) && ahead >= 0 && opensRecord(lines, ahead)) {
      current = undefined;
      continue;
    }
    if (/^Error fetching \S+: /u.test(line)) continue;
    const title = heading(lines, index);
    const labelled = title !== null ? { name: 'Title', value: title } : field(line);
    if (labelled && RECORD_FIELDS.has(labelled.name) && (!current?.into || (afterBlank && opensRecord(lines, index)))) {
      if (!current || current.url !== undefined || (labelled.name === 'Title' && current.title !== undefined)) {
        current = { snippet: [], body: [] };
        records.push(current);
      }
      current.into = undefined;
      if (labelled.name === 'Title') current.title = labelled.value;
      if (labelled.name === 'URL') current.url = labelled.value;
      continue;
    }
    if (!current) continue;
    if (labelled && (labelled.name === 'Favicon' || labelled.name === 'Score')) {
      current.into = undefined;
      continue;
    }
    if (labelled && labelled.name === 'Raw Content' && current.into !== 'body') {
      current.into = 'body';
      if (labelled.value) current.body.push(labelled.value);
      continue;
    }
    if (labelled && !current.into && SNIPPET_LABELS.has(labelled.name)) {
      current.into = 'snippet';
      if (labelled.value) current.snippet.push(labelled.value);
      continue;
    }
    if (labelled && !current.into && (labelled.name === 'Published' || labelled.name === 'Author')) {
      if (labelled.name === 'Published') current.published = labelled.value;
      continue;
    }
    if (current.into) current[current.into].push(line);
    // A page reader's text follows the page's address and dates without a label.
    else if (current.url !== undefined && line.trim()) {
      current.into = 'body';
      current.body.push(line);
    }
  }
  return records;
}

const string = (value: unknown) => typeof value === 'string' && value.trim() ? value : undefined;

/** `structuredContent.results` (or a bare list), with the field names search APIs commonly use. */
function structuredRecords(value: unknown): Draft[] {
  const list = Array.isArray(value) ? value
    : value && typeof value === 'object' && Array.isArray((value as { results?: unknown }).results) ? (value as { results: unknown[] }).results
    : null;
  if (!list) return [];
  return list.flatMap((item): Draft[] => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const highlights = Array.isArray(row.highlights) ? row.highlights.filter((part): part is string => typeof part === 'string').join('\n') : undefined;
    const snippet = string(row.content) ?? string(highlights) ?? string(row.snippet) ?? string(row.description) ?? string(row.summary);
    const body = string(row.raw_content) ?? string(row.rawContent) ?? string(row.markdown) ?? string(row.text);
    return [{
      title: string(row.title) ?? string(row.name),
      url: string(row.url) ?? string(row.link) ?? string(row.href),
      published: string(row.publishedDate) ?? string(row.published_date) ?? string(row.published),
      snippet: snippet ? [snippet] : [], body: body ? [body] : [],
    }];
  });
}

/** Markdown links, each with the rest of its line as the snippet. */
function linkRecords(text: string): Draft[] {
  return text.split(/\r?\n/u).flatMap((line) => {
    const links = [...line.matchAll(/\[([^\]\n]{1,300})\]\((https?:\/\/[^\s)]+)\)/gu)];
    const rest = line.replace(/\[([^\]\n]{1,300})\]\((https?:\/\/[^\s)]+)\)/gu, '$1').replace(/^[\s>*+-]*(?:\d+\.\s+)?/u, '').trim();
    return links.map(([, title, url]) => ({ title, url, snippet: rest && rest !== title ? [rest] : [], body: [] }));
  });
}

export function httpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function hostname(url: string) {
  return new URL(url).hostname.replace(/^www\./u, '');
}

/** Lines joined, trimmed, and at most one empty line in a row. */
function tidy(lines: readonly string[]) {
  return lines.join('\n').replace(/[ \t]+$/gmu, '').replace(/\n{3,}/gu, '\n\n').trim();
}

function finish(draft: Draft, prefer: 'snippet' | 'body'): WebSearchResult | null {
  const url = httpUrl(draft.url);
  if (!url) return null;
  const snippet = tidy(draft.snippet), body = tidy(draft.body);
  const title = draft.title?.replace(/\s+/gu, ' ').trim();
  const published = draft.published?.trim();
  return {
    title: title && !/^(?:N\/A|\(no title\))$/iu.test(title) ? title : hostname(url),
    url,
    content: prefer === 'snippet' ? snippet || body : body || snippet,
    ...(published && published !== 'N/A' ? { publishedAt: published } : {}),
  };
}

function usable(drafts: readonly Draft[], prefer: 'snippet' | 'body') {
  const seen = new Set<string>();
  return drafts.flatMap((draft) => {
    const result = finish(draft, prefer);
    if (!result || seen.has(result.url)) return [];
    seen.add(result.url);
    return [result];
  });
}

/** Search results in the order the service ranked them, one per address; empty when it found nothing usable. */
export function parseWebSearchResults(output: WebToolOutput): WebSearchResult[] {
  for (const drafts of [structuredRecords(output.structured), labelledRecords(output.text)]) {
    const results = usable(drafts, 'snippet');
    if (results.length) return results;
  }
  return usable(linkRecords(output.text), 'snippet');
}

/** The same address, whatever its fragment or trailing slash. */
function samePage(left: string, right: string) {
  const key = (url: string) => {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href.replace(/\/$/u, '');
  };
  return key(left) === key(right);
}

/**
 * The page at `url`: the record for that address, else the first one with text (a page that redirected keeps the
 * address the service read). A service that wrote the page without records gives its whole text. Null when the
 * records have no text, or nothing but framing or a "nothing found" remains.
 */
export function parseWebPage(output: WebToolOutput, url: string): WebPage | null {
  const records = [...usable(structuredRecords(output.structured), 'body'), ...usable(labelledRecords(output.text), 'body')];
  if (records.length) {
    const pages = records.filter((page) => page.content);
    return pages.find((page) => samePage(page.url, url)) ?? pages[0] ?? null;
  }
  const text = tidy(output.text.replace(/\r\n?/gu, '\n').split('\n')
    .filter((line) => !/^(?:Request ID: .*|Detailed Results:|Error fetching \S+: .*)$/u.test(line)));
  if (!text || NOTHING_FOUND.test(text)) return null;
  return { title: hostname(url), url, content: text };
}
