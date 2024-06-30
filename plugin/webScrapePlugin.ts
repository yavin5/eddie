import { jsonToPlainText, Options } from "json-to-plain-text";
import { JSDOM } from 'jsdom';
//import fetch from 'node-fetch';
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
        if (searchQuery.toLowerCase().includes('real-time data')
         || searchQuery.toLowerCase().includes('coronavirus')
         || searchQuery.toLowerCase().includes('live search data')
         || searchQuery.toLowerCase().includes('covid')
         || searchQuery.toLowerCase().includes('corona virus')) {
            return 'Error. Search query incorrect.  Please answer that you don\'t know.';
        }

        // Currently implemented as a search.brave.com searcher.
        // offset = 1            : The zero based offset that indicates number of results per page to skip before returning results.
        // count = 18            : This is supposed to return 6 results. We need small output to LLM!
        // result_filter = 'discussions,faq,infobox,news,query,web' : A comma delimited string of result types to include in the response.
        // freshness = pm        : Return results that are fresh to within 1 month.
        // extra_snippets = true : Return some text excerpts from the result page.
        // text_decorations = 0  : We don't want a highlighted colored text response.
        let url = 'https://api.search.brave.com/res/v1/web/search?count=18&freshness=pm&extra_snippets=true&text_decorations=0&q=' + searchQuery;

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
            for (let line of textLines) {
                //console.log("LINE: " + line);
                if (!(line.startsWith('url : ') || line.startsWith('title : ') || line.startsWith('description : '))) {
                   textLines[arrayIndex] = '';
                }
                // Some web sites are too fictional.  We need factual, pertinent data.
                line = line.toLowerCase();
                if (line.includes('forbes.com') || line.includes('usatoday.com')
                 || line.includes('yahoofinance.com') || line.includes('finance.yahoo.com') 
                 || line.includes('bankrate.com') || line.includes('coingape.com')
                 || line.includes('cryptonews.com') || line.includes('zebpay.com')
                 || line.includes('ndtv.com') || line.includes('indiatimes.com')
                 || line.includes('democracynow.org') || line.includes('nationalpost.com')
                 || line.includes('youtube.com') || line.includes('milkroad.com')) {
                    textLines[arrayIndex] = '';
                    for (let index = arrayIndex; index >= 0; index--) {
                        if (textLines[index].startsWith('title : ')) {
                            textLines[index] = '';
                            if (textLines.lengtht > 4 && textLines[index - 5] && textLines[index - 5].startsWith('description : ')) {
                                textLines[index - 5] = '';
                            }
                            if (textLines[index + 1] && textLines[index + 1].startsWith('description : ')) {
                                textLines[index + 1] = '';
                            }
                            if (textLines[index + 2] && textLines[index + 2].startsWith('description : ')) {
                                textLines[index + 2] = '';
                            }
                            if (textLines[index + 3] && textLines[index + 3].startsWith('description : ')) {
                                textLines[index + 3] = '';
                            }
                            break;
                        }
                    }
                }
                arrayIndex++;
            }
            plainText = textLines.join('\n');
            plainText = plainText.replace(/\n\n\n(\n)+/g, '\n---\n');
            plainText = plainText.replace(/\n\n/g, '\n');

            const query = searchQuery.toLocaleLowerCase();
            // These shouldn't be hard-coded here except Brave Search returns bad results otherwise.
            if (query.includes('crypto')    || query.includes('coin')
             || query.includes('bitcoin')   || query.includes('token')
             || query.includes(' eth')      || query.includes('ethereum')
             || query.includes('blockchain')|| query.includes('blockdag')) {
                plainText = 'title : Prices, market cap, cryptocurrency stats, up to date!\nurl : https://coingecko.com\n---\n'
                    + plainText;
             }

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
     * @returns {string} The HTTP response content
     */
    async httpGet(url: string): Promise<string> {
        // TODO: Handle HTTP sessions (some sites break if no cookies are returned)
        const requestHeaders: HeadersInit = new Headers();
        //requestHeaders.set('Accept', 'application/json');

        // Sometimes the LLM is sending URLs that contain spaces nor quotes.  :(
        let url2 = url.replace(/\s+/g, '');
        url2 = url2.replace(/"/g, '');

        // Don't bother making requests to example.com.
        if (url2.includes('example.com') || url2.includes('example2.com')) {
            return 'The domain example.com is not a real web site. Try a different site.';
        }
        if (url2.includes('coinmarketcap.com')) {
            return 'This domain does not allow you to perform HTTP GETs. Try a different site.';
        }
        // Disallow repeated useless web interrogation that the LLM tends to do.
        if (url2.toLowerCase().includes('real-time data')
         || url2.toLowerCase().includes('coronavirus')
         || url2.toLowerCase().includes('covid')) {
            return 'ERROR. Your query is wrong. Stay on topic of the user\'s question.';
        }

        if (!url2.startsWith('http')) {
            url2 = `https://${url2}`;
        }
        if (url2.includes('wikipedia.org')) {
            // Switch to the plain text way to search wikipedia.
            let query: string | null = '';
            if (url.includes('&titles=')) {
                const matches = url2.match(/[^&titles=](.*)[^&]/g);
                if (matches) {
                    query = matches[0];
                }
            }
            url2 = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=&explaintext=&exlimit=3&titles=w:${query}`;
        }

        try {
            console.log("WebScrapePlugin: httpGet.");

            let plainText = '';
            let jsonText: string = '';
            await fetch(url2, {
                method: 'GET',
                headers: requestHeaders
            }).then(response => response.text())
              .then(data => { jsonText = data; })
              .catch(error => {
                console.error(error);
                plainText = `HTTP GET request error: ${error}`;
            });

            if (jsonText.startsWith('{')) {
                plainText = this.scrapeJsonToPlainText(jsonText);
            } else if (jsonText.startsWith('<')) {
                plainText = this.scrapeHtmlToPlainText(jsonText);
            }
            return plainText;
        } catch (error) {
            // TODO: In the case of a 403, follow a small number of redirects.
            const response = `HTTP GET exception: ${error}`;
            console.error(response);
            return response;
        }
    }

    /**
     * Convert thick HTML into smaller readable plain text.
     * @param {string} htmlText 
     * @returns {string} the plain text representation of the HTML.
     */
    scrapeHtmlToPlainText(htmlText: string): string {
        const dom = new JSDOM(htmlText);
        const document = dom.window.document;

        // Remove all <script>, <style>, and <svg> elements
        Array.from(document.querySelectorAll('script, style, svg')).forEach(element => {
            (element as any).remove();
        });

        // Extract text content
        const textContent = document.body.textContent || '';
  
        // Normalize whitespace
        const plainText = textContent.replace(/\s+/g, ' ').trim();

        //console.log(`Plain text of this HTML: ${plainText}`);
        return plainText;
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
