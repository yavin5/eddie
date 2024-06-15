import { jsonToPlainText, Options } from "json-to-plain-text";
const { compile, convert } = require('html-to-text');
// TODO: Probably should import and use node-fetch:
// https://github.com/node-fetch/node-fetch

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
     * Uses an HTTP client to perform a web search GET request, and returns the
     * search results as web response content.
     * @llmFunction
     * @param {string} searchQuery The free-form text of a search query request.
     * @returns {string} The search results content containing links of web pages
     * that contain content that is closely related to the search query.
     */
    async webSearch(searchQuery: string): Promise<string> {

        // The LLM likes to search for these useless search queries.
        if (searchQuery.toLowerCase() == 'real-time data analytics'
         || searchQuery.toLowerCase() == 'coronavirus latest news'
         || searchQuery.toLowerCase() == 'live search data') {
            return 'Error. Search query incorrect.  Please answer that you don\'t know.';
        }

        // Currently implemented as a search.brave.com searcher.
        // count = 3 : This is supposed to return 3 results. We need small output to LLM!
        // text_decorations = 0 : We don't want a highlighted colored text response.
        let url = 'https://api.search.brave.com/res/v1/web/search?count=3&text_decorations=0&q=' + searchQuery;

        try {
            let jsonText: string = '';
            const searchApiKey = process.env.PLUGIN_WEBSCRAPE_BRAVE_SEARCH_KEY;
            const requestHeaders: HeadersInit = new Headers();
            requestHeaders.set('Accept', 'application/json');
            requestHeaders.set('Accept-Encoding', 'gzip');
            requestHeaders.set('X-Subscription-Token', searchApiKey! || '');
            
            await fetch(url, {
                method: 'GET',
                headers: requestHeaders
            }).then(response => response.json())
              .then(data => { jsonText = data; })
              .catch(error => console.error(error));

            console.log("WebScrapePlugin: webSearch.");

            let plainText = this.scrapeJsonToPlainText(jsonText);

            // Scrape out url, title, description fields.
            let textLines: string[] = plainText.split('\n');
            let arrayIndex = 0;
            for (const line of textLines) {
                if (!(line.startsWith('url : ') || line.startsWith('title : ') || line.startsWith('description : '))) {
                   textLines[arrayIndex] = '';
                }
                arrayIndex++;
            }
            plainText = textLines.join('\n');
            plainText = plainText.replace(/\n\n\n(\n)+/g, '\n---\n');
            plainText = plainText.replace(/\n\n/g, '\n');
            //console.log('\n\n\n\nwebSearch returning: \n\n' + plainText);

            return plainText;
        } catch(error) {
            // FIXME: In the case of a 403, follow a small number of redirects.
            let response = `HTTP GET request error: ${error}`;
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
        // TODO: Handle HTTP sessions (some sites break if no cookies are returned)
        const requestHeaders: HeadersInit = new Headers();
        //requestHeaders.set('Accept', 'application/json');

        // Sometimes the LLM is sending URLs that contain spaces.  :(
        let url2 = url.replace(/\S+/g, '');

        // Don't bother making requests to example.com.
        if (url2.includes('example.com') || url2.includes('example2.com')) {
            return 'The domain example.com is not a real web site. Try a different site.';
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
            url2 = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=&explaintext=&exlimit=3&titles=w:${query}`;
        }

        try {
            let jsonText: string = '';
            await fetch(url, {
                method: 'GET',
                headers: requestHeaders
            }).then(response => response.text())
              .then(data => { jsonText = data; })
              .catch(error => console.error(error));

            console.log("WebScrapePlugin: httpGet.");
            let plainText = this.scrapeJsonToPlainText(jsonText);
            // TODO: Maybe convert this to requesting HTML, and then scrape plain text.
            return plainText;
        } catch (error) {
            // FIXME: In the case of a 403, follow a small number of redirects.
            const response = `HTTP GET request error: ${error}`;
            console.error(response);
            return response;
        }
    }

    // WIP, not ready yet.
    async httpPost(url: string, params?: string[], data?: string): Promise<any> {
        const requestHeaders: HeadersInit = new Headers();
        requestHeaders.set('Accept', 'application/json');

        let body: { [key: string]: any } = {};
        if (params) {
            for (const param in params) {
                const parts = param.split('=');
                if (parts.length == 2) {
                    const key = parts[0];
                    let val = parts[1];
                    body[key] = val;
                }
            }
        }
        try {
            let jsonText: string = '';

            await fetch(url, {
                method: 'POST',
                body: JSON.stringify(body),
                headers: requestHeaders
            }).then(response => response.json())
              .then(data => { jsonText = data; })
              .catch(error => console.error(error));

            console.log("WebScrapePlugin: httpPost.");
            return jsonText;
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
    scrapeHtmlToPlainText(htmlText: string): string {
        const options = {
            wordwrap: 130,
            // ...
        };
        let compiledConvert = compile(options);
        let arr = htmlText.split(/\r?\n/);
        console.log('HTML lines: ' + arr.length);
        let plainTextArr = arr.map(compiledConvert);
        const result: string = plainTextArr.join('\n');
        console.log('Plain text of this HTML: ' + result);
        return result;
    }

    /**
    * Convert JSON text into smaller readable plain text.
    * @param {string} jsonText
    * @returns {string} the plain text representation of the JSON.
    */
    scrapeJsonToPlainText(jsonText: string): string {
        const options: Options = {
            color: false,                  // Whether to apply colors to the output or not
            spacing: false,                 // Whether to include spacing before colons or not
            seperator: ":",                // seperate keys and values.
            squareBracketsForArray: false, // Whether to use square brackets for arrays or not
            doubleQuotesForKeys: false,    // Whether to use double quotes for object keys or not
            doubleQuotesForValues: false,  // Whether to use double quotes for string values or not
        };
        let result: string = jsonToPlainText(jsonText, options);
        return result;
    }
}

// The plugin class must be the default export of the plugin file.
export default WebScrapePlugin;
