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
                    if (key == 'url') {
                        val = val.replace(/\s/g, '');
                    }
                    Object.assign(axiosParams, { key: val });
                }
            }
        }
        let response;
        try {
            response = await axios.get(url, { params: axiosParams });
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
