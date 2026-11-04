import axios from 'axios';
import http from 'http';
import https from 'https';
import * as cheerio from 'cheerio';
import { AgentTool, ToolResult, USER_AGENT } from '../../types';
import { createPinnedLookup, resolvePublicHttpUrl } from '../../utils/network';

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const MAX_OUTPUT_CHARS = 8000;

export const WebScraperTool: AgentTool = {
  definition: {
    name: 'web_scrape',
    description:
      'Fetch a public HTTP or HTTPS web page and return its readable text content. Local/private network addresses are blocked. Use this to read the contents of a URL the user provides.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute public URL to fetch (http/https)' },
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

    try {
      let destination = await resolvePublicHttpUrl(String(args.url || '').trim());
      let target = destination.url;
      let response: Awaited<ReturnType<typeof axios.get<string>>> | undefined;
      for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
        const pinnedLookup = createPinnedLookup(target.hostname, destination.addresses);
        const httpAgent = new http.Agent({ lookup: pinnedLookup });
        const httpsAgent = new https.Agent({ lookup: pinnedLookup });
        try {
          response = await axios.get<string>(target.toString(), {
            timeout: 25000,
            maxContentLength: MAX_RESPONSE_BYTES,
            maxBodyLength: MAX_RESPONSE_BYTES,
            maxRedirects: 0,
            proxy: false,
            httpAgent,
            httpsAgent,
            headers: {
              'User-Agent': USER_AGENT,
              Accept: 'text/html,application/xhtml+xml,text/plain,application/json,*/*;q=0.8',
            },
            responseType: 'text',
            transformResponse: [(data: unknown) => data],
            validateStatus: () => true,
          });
        } finally {
          httpAgent.destroy();
          httpsAgent.destroy();
        }

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const locationHeader = response.headers['location'];
          const location = typeof locationHeader === 'string' ? locationHeader : '';
          if (!location) return { success: false, output: `HTTP ${response.status} redirect without a Location header.` };
          if (redirectCount === MAX_REDIRECTS) {
            return { success: false, output: `Too many redirects (maximum ${MAX_REDIRECTS}).` };
          }
          destination = await resolvePublicHttpUrl(new URL(location, target).toString());
          target = destination.url;
          continue;
        }
        break;
      }

      if (!response || response.status >= 400) {
        return { success: false, output: `HTTP ${response?.status || 'unknown'} for ${target.toString()}` };
      }

      const contentType = String(response.headers['content-type'] || '').toLowerCase();
      if (contentType && !/(text\/|application\/(xhtml\+xml|json|xml))/i.test(contentType)) {
        return { success: false, output: `Unsupported page content type: ${contentType}` };
      }

      const $ = cheerio.load(String(response.data || ''));
      $('script,style,noscript,iframe,svg,nav,footer,header,form').remove();
      let text = '';
      if (args.selector) {
        const selector = $(String(args.selector));
        if (selector.length) text = selector.text();
      }
      if (!text) text = $('body').text() || $.root().text();
      text = text.replace(/\s+/g, ' ').trim();
      if (text.length > MAX_OUTPUT_CHARS) text = `${text.slice(0, MAX_OUTPUT_CHARS)}\n...[truncated]`;
      return { success: true, output: text || '(no readable content)' };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, output: `Failed to fetch page: ${msg}` };
    }
  },
};
