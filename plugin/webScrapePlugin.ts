import axios from 'axios';

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
     * Uses an HTTP client to perform an HTTP GET request and returns the scraped web response content.
     * @llmFunction
     * @param {string} url The HTTP URL to request
     * @param {string[]} [params] Request parameters as name=value strings.
     * @returns {string} The HTTP response content
     */
    async httpGet(url: string, params?: string[]): Promise<string> {
        // TODO: Handle HTTP sessions.
        // TODO: Handle HTTPS?
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
}

// The plugin class must be the default export of the plugin file.
export default WebScrapePlugin;
