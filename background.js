// Capture only document requests from tabs whose panel has started monitoring.
function getCoordinates(requestUrl) {
    try {
        const url = new URL(requestUrl);
        if (url.hostname !== "www.google.com" || url.pathname !== "/maps/embed/v1/streetview") return null;
        const location = url.searchParams.get("location");
        const match = location?.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/);
        if (!match || Math.abs(Number(match[1])) > 90 || Math.abs(Number(match[2])) > 180) return null;
        return `${match[1]},${match[2]}`;
    } catch {
        return null;
    }
}

const captureKey = tabId => `capture:${tabId}`;
const trackedKey = tabId => `tracked:${tabId}`;
let pendingCapture = Promise.resolve();
const recentRequests = new Set();

// Give each page its own panel instance, bound to that tab even when tabs change.
function configureTab(tab) {
    return chrome.sidePanel.setOptions({ tabId: tab.id, path: `panel.html?tabId=${tab.id}`, enabled: true });
}
// Chrome opens the configured tab-specific panel directly on the toolbar click.
// Preparing it ahead of time avoids losing the click's user gesture to async work.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
chrome.tabs.onCreated.addListener(tab => configureTab(tab).catch(console.error));
chrome.tabs.query({}).then(tabs => Promise.all(tabs.map(configureTab))).catch(console.error);

chrome.webRequest.onBeforeRequest.addListener((request) => {
    const coordinates = getCoordinates(request.url);
    if (!coordinates || request.tabId < 0 || recentRequests.has(request.requestId)) return;
    recentRequests.add(request.requestId);
    if (recentRequests.size > 100) recentRequests.delete(recentRequests.values().next().value);

    pendingCapture = pendingCapture.then(async () => {
        const tracked = await chrome.storage.session.get(trackedKey(request.tabId));
        if (!tracked[trackedKey(request.tabId)]) return;
        const capture = {
            timestamp: new Date(request.timeStamp).toISOString(),
            coordinates,
            mapsUrl: `https://www.google.com/maps?q=${coordinates}`,
            embedUrl: `https://www.google.com/maps?q=${coordinates}&z=15&output=embed`,
            request: { url: request.url, method: request.method, type: request.type, tabId: request.tabId }
        };
        await chrome.storage.session.set({ [captureKey(request.tabId)]: capture });
        chrome.runtime.sendMessage({ type: "STATE_UPDATED", tabId: request.tabId, state: toState(capture, true) }, () => {
            void chrome.runtime.lastError;
        });
    }).catch(console.error);
}, {
    urls: ["https://www.google.com/maps/embed/v1/streetview*", "http://www.google.com/maps/embed/v1/streetview*"],
    types: ["main_frame", "sub_frame"]
});

function toState(capture, monitoring) {
    return { monitoring, displayed: capture || null };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!["GET_STATE", "REFRESH_LATEST", "START_MONITORING", "STOP_MONITORING"].includes(message.type)) return;
    if (!Number.isInteger(message.tabId) || message.tabId < 0) return;
    pendingCapture = pendingCapture.then(async () => {
        const key = trackedKey(message.tabId);
        const stored = await chrome.storage.session.get([captureKey(message.tabId), key]);
        let monitoring = stored[key] ?? true;
        if (message.type === "START_MONITORING") monitoring = true;
        if (message.type === "STOP_MONITORING") monitoring = false;
        await chrome.storage.session.set({ [key]: monitoring });
        const state = toState(stored[captureKey(message.tabId)], monitoring);
        sendResponse(state);
        if (message.type === "START_MONITORING" || message.type === "STOP_MONITORING") {
            chrome.runtime.sendMessage({ type: "STATE_UPDATED", tabId: message.tabId, state }, () => {
                void chrome.runtime.lastError;
            });
        }
    }).catch(() => sendResponse({ error: "Unable to update monitoring." }));
    return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
    pendingCapture = pendingCapture.then(() => chrome.storage.session.remove([
        captureKey(tabId), trackedKey(tabId)
    ])).catch(console.error);
});
