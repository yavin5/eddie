
/**
 * Implements a web REST API clients for obtaining up to date location-based
 * information such as from the world map, or based on a city name, etc.
 * 
 * The initial version of several functions included in this plugin was taken
 * from technovangelist / Matt Williams' video demo code:
 * https://github.com/technovangelist/videoprojects/blob/main/2024-07-10-functioncalling-with-tools/tools.ts
 * 
 * @author Matt Williams
 * @author Yavin Five
 */
class MapsPlugin {
    public constructor() {
        console.log('MapsPlugin loaded.');
    }

    /**
     * Pass the name of a city, and this function will return the latitude and longitude of
     * the city.
     * @llmFunction
     * @param {string} city Name of the city.
     * @returns {string[]} an array where the first element is the latitude, and the
     *  second element is the longitude.
     */
    async cityToLatLon(city: string) {
        const output = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${city}&format=json`,
        );
        const json = await output.json();
        return [json[0].lat, json[0].lon];
    }

    /**
     * Pass the latitude and longitude of a location, and this function will return the 
     * name of the city.
     * @llmFunction
     * @param {string} latitude the latitude of the location.
     * @param {string} longitude the longitude of the location.
     * @returns {string} the name of the city at that location.
     */
    async latLonToCity(latitude: string, longitude: string) {
        const output = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
        );
        const json = await output.json();
        return json.display_name;
    }

    /**
     * Pass the latitude and longitude of a location, and this function will return the 
     * current weather at that location.
     * @llmFunction
     * @param {string} latitude the latitude of the location.
     * @param {string} longitude the longitude of the location.
     * @returns {string} the up to date weather at the specified location.
     */
    async latLonToWeather(latitude: string, longitude: string) {
        const output = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m&temperature_unit=celsius&wind_speed_unit=mph&forecast_days=1`,
        );

        const json = await output.json();
        return `${json.current.temperature_2m} C`;
    }

    /**
     * Pass the name of the city, and this function will return the current weather there.
     * @llmFunction
     * @param {string} city the name of the city.
     * @returns {string} the up to date weather for the specified city.
     */
    async cityToWeather(city: string) {
        const latlon = await this.cityToLatLon(city);
        return await this.latLonToWeather(latlon[0], latlon[1]);
    }
}