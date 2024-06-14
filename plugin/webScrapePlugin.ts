import axios, { AxiosHeaders } from 'axios';
const { compile } = require('html-to-text');

/**
 * Implements a web client for scraping data off the web, and
 * also for posting data to the web.
 * 
 * @author Yavin Five
 */
class WebScrapePlugin {
    public constructor() {
        console.log('WebScrapePlugin loaded.');
    }

    /**
     * Uses an HTTP client to perform a web search GET request for live search results data, and
     * returns the results as web response content.
     * @llmFunction
     * @param {string} searchQuery The free-form text of a search query request.
     * @returns {string} The search results content containing links of web pages that contain
     *  content that is closely related to the search query.
     */
    async webSearch(searchQuery: string): Promise<string> {
        let axiosParams = {};

        // Currently implemented as a search.brave.com searcher.
        let url = 'https://api.search.brave.com/res/v1/web/search?q=' + searchQuery;

        let response;
        try {
            const headers = new AxiosHeaders();
            headers.set('User-Agent', 'LLM');
            headers.set('Accept', 'application/json');
            headers.set('Accept-Encoding', 'gzip');
            headers.set('X-Subscription-Token',
                process.env.PLUGIN_WEBSCRAPE_BRAVE_SEARCH_KEY);
            console.log(JSON.stringify(headers));
            response = await axios.get(url, { headers: headers });
            await new Promise<void>(resolve => setTimeout(() => resolve(), 1000))
                .then(() => console.log("WebScrapePlugin: webSearch."));
            return this.scrapeHtmlText(response.data);
        } catch (error) {
            // FIXME: In the case of a 403, follow a small number of redirects.
            response = `HTTP GET request error: ${error}`;
            console.error(response);
            return response;
        }
    }

    /**
     * Uses an HTTP client to perform an HTTP GET request and returns the scraped web response content.
     * @llmFunction
     * @param {string} url The HTTP URL to request
     * @param {string[]} [params] Request parameters as name=value strings.
     * @returns {string} The HTTP response content
     */
    async httpGet(url: string, params?: string[]): Promise<string> {
        // TODO: Handle HTTP sessions.
        let axiosParams = {};
        if (params) {
            for (const param in params) {
                const parts = param.split('=');
                if (parts.length == 2) {
                    const key = parts[0];
                    let val = parts[1];
                    Object.assign(axiosParams, { key: val });
                }
            }
        }
        let url2 = url.replace(/\s+/g, '');
        if (url2.includes('example.com') || url2.includes('example2.com')) {
            return 'The domain example.com is not a real web site. Try a differ\
ent site.';
        }
        if (!url2.startsWith('http')) {
            url2 = `http://${url2}`;
        }
        if (url2.includes('wikipedia.org')) {
            // Switch to the plain text way to search wikipedia.
            let query: string | null = '';
            if (url.includes('&titles=')) {
                const matches = url.match(/[^&titles=](.*)[^&]/g);
                if (matches) {
                    query = matches[0];
                } else if (params) {
                    if (params.indexOf('query')) query = params[params.indexOf('query')];
                    if (params.indexOf('q')) query = params[params.indexOf('q')];
                    if (params.indexOf('titles')) query = params[params.indexOf('titles')];
                }
            }
            url2 = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=&explaintext=&exlimit=10&titles=w:${query}`;
        }

        let response;
        try {
            response = await axios.get(url2, { params: axiosParams });
            await new Promise<void>(resolve => setTimeout(() => resolve(), 1000))
                .then(() => console.log("WebScrapePlugin: httpGet."));
            return response.data;
        } catch (error) {
            // FIXME: In the case of a 403, follow a small number of redirects.
            response = `HTTP GET request error: ${error}`;
            console.error(response);
            return response;
        }
    }

    async httpPost(url: string, data: Record<string, any>): Promise<any> {
        try {
            const response = await axios.post(url, data);
            return response.data;
        } catch (error) {
            console.error('POST request error:', error);
            throw error;
        }
    }

    /**
     * Convert thick HTML into smaller readable plain text.
     * @param {string} htmlText 
     * @returns {string} the plain text representation of the HTML.
     */
    scrapeHtmlText(htmlText: string): string {
        const options = {
            wordwrap: 130,
            // ...
        };
        let compiledConvert = compile(options);
        let arr = htmlText.split(/\r?\n/);
        let plainTextArr = arr.map(compiledConvert);
        const separator = '\n';
        const result: string = plainTextArr.join(separator);
        return result;
    }
}

// The plugin class must be the default export of the plugin file.
export default WebScrapePlugin;
