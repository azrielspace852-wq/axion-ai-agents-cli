import axios from 'axios';
import * as cheerio from 'cheerio';
import { AgentTool, ToolResult, BROWSER_UA } from '../../types';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function googleSearch(q: string, max: number): Promise<SearchResult[]> {
  const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&num=${max + 5}&hl=en`;
  const res = await axios.get(url, {
    headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en' },
    timeout: 20000,
    validateStatus: (s) => s < 500,
  });
  if (res.status >= 400) throw new Error(`Google Search returned HTTP ${res.status}`);
  const $ = cheerio.load(res.data);
  const results: SearchResult[] = [];
  $('div.g, div[data-hveid]').each((_, el) => {
    const a = $(el).find('a[href^="http"]').first();
    const h3 = $(el).find('h3').first();
    const href = a.attr('href');
    const title = h3.text() || a.text();
    if (href && title) {
      const snippet =
        $(el).find('div[data-sncf], div.VwiC3b, span.aCOpRe').first().text() || '';
      results.push({ title: title.trim(), url: href, snippet: snippet.trim() });
    }
    if (results.length >= max) return false;
  });
  return results;
}

async function ddgSearch(q: string, max: number): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  const res = await axios.get(url, {
    headers: { 'User-Agent': BROWSER_UA },
    timeout: 20000,
    validateStatus: (s) => s < 500,
  });
  if (res.status >= 400) throw new Error(`DuckDuckGo Search returned HTTP ${res.status}`);
  const $ = cheerio.load(res.data);
  const results: SearchResult[] = [];
  $('.result').each((_, el) => {
    const a = $(el).find('a.result__a');
    const snippet = $(el).find('.result__snippet').text();
    let href = a.attr('href') || '';
    if (href.startsWith('//')) href = `https:${href}`;
    const m = href.match(/uddg=([^&]+)/);
    if (m) {
      try {
        href = decodeURIComponent(m[1]);
      } catch {
        /* keep raw */
      }
    }
    const title = a.text();
    if (href && title) {
      results.push({ title: title.trim(), url: href, snippet: snippet.trim() });
    }
    if (results.length >= max) return false;
  });
  return results;
}

export const GoogleSearchTool: AgentTool = {
  definition: {
    name: 'google_search',
    description:
      'Search the web to get up-to-date, real-time information. Returns a list of results with title, link, and snippet. Use this when the question needs current data.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        maxResults: { type: 'number', description: 'Max results to return (default 5)' },
      },
      required: ['query'],
    },
  },
  async execute(args, ctx): Promise<ToolResult> {
    if (!ctx.permissions.searchAccess) {
      return { success: false, output: 'Permission denied: searchAccess is disabled.' };
    }
    const q = String(args.query || '').trim();
    if (!q) return { success: false, output: 'Empty query.' };
    const requestedMax = Number(args.maxResults);
    const max = Number.isFinite(requestedMax) && requestedMax > 0
      ? Math.min(10, Math.floor(requestedMax))
      : 5;
    try {
      let results: SearchResult[] = [];
      try {
        results = await googleSearch(q, max);
      } catch {
        results = [];
      }
      if (!results.length) results = await ddgSearch(q, max);
      if (!results.length) return { success: false, output: 'No results found.' };
      const out = results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
        .join('\n\n');
      return { success: true, output: out };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, output: `Search failed: ${msg}` };
    }
  },
};