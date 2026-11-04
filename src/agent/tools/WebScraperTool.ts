import axios from 'axios';
import * as cheerio from 'cheerio';
import { AgentTool, ToolResult, USER_AGENT } from '../../types';

export const WebScraperTool: AgentTool = {
  definition: {
    name: 'web_scrape',
    description:
      'Fetch a web page by URL and return its readable text content (HTML stripped). Use this to read the contents of a URL the user provides.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute URL to fetch (http/https)' },
        selector: {
          type: 'string',
          description: 'Optional CSS selector to narrow down the content',
        },
      },
      required: ['url'],
    },
  },
  async execute(args, ctx): Promise<ToolResult> {
    if (!ctx.permissions.webAccess) {
      return {
        success: false,
        output: 'Permission denied: webAccess is disabled. Enable it via /permissions.',
      };
    }
    const url = String(args.url || '');
    if (!/^https?:\/\//i.test(url)) {
      return { success: false, output: 'Invalid URL. Must start with http:// or https://' };
    }
    try {
      const res = await axios.get(url, {
        timeout: 25000,
        maxContentLength: 5 * 1024 * 1024,
        maxRedirects: 5,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,text/plain,*/*',
        },
        responseType: 'text',
        transformResponse: [(d) => d],
        validateStatus: (s) => s < 500,
      });
      if (res.status >= 400) {
        return { success: false, output: `HTTP ${res.status} for ${url}` };
      }
      const $ = cheerio.load(res.data);
      $('script,style,noscript,iframe,svg,nav,footer,header,form').remove();
      let text = '';
      if (args.selector) {
        const sel = $(String(args.selector));
        if (sel.length) text = sel.text();
      }
      if (!text) text = $('body').text() || $.root().text();
      text = text.replace(/\s+/g, ' ').trim();
      const max = 8000;
      if (text.length > max) text = `${text.slice(0, max)}\n...[truncated]`;
      return { success: true, output: text || '(no readable content)' };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, output: `Failed to fetch ${url}: ${msg}` };
    }
  },
};