const status = document.getElementById("status");
const map = document.getElementById("map");
let tabId = null;
let currentCapture = null;
let currentState = null;
let controlsBusy = false;

function render(state) {
    if (state?.error) {
        status.textContent = state.error;
        return;
    }
    currentState = state;
    currentCapture = state?.displayed || null;
    document.getElementById("start").disabled = controlsBusy || !!state?.monitoring;
    document.getElementById("stop").disabled = controlsBusy || !state?.monitoring;
    document.getElementById("copy").disabled = !currentCapture;
    document.getElementById("download").disabled = !currentCapture;
    document.getElementById("empty").hidden = !!currentCapture;
    map.hidden = !currentCapture;
    document.getElementById("coordinates").textContent = currentCapture?.coordinates || "";
    document.getElementById("output").textContent = currentCapture
        ? JSON.stringify(currentCapture, null, 2)
        : "No request captured for this page yet.";
    status.textContent = !state?.monitoring
        ? "Stopped. Click Start to capture new requests from this page."
        : currentCapture
            ? "Monitoring this page only. Map shows the latest captured request."
            : "Monitoring this page only. Reload it or start a new round.";
    // Updating unrelated state must not reset the user's map pan/zoom.
    if (currentCapture && map.getAttribute("src") !== currentCapture.embedUrl) {
        map.src = currentCapture.embedUrl;
    } else if (!currentCapture) {
        map.removeAttribute("src");
    }
}

async function refresh() {
    if (tabId === null) return;
    try {
        render(await chrome.runtime.sendMessage({ type: "GET_STATE", tabId }));
    } catch {
        status.textContent = "Unable to connect. Reload the extension and reopen this panel.";
    }
}

chrome.runtime.onMessage.addListener(message => {
    if (message.type === "STATE_UPDATED" && message.tabId === tabId) render(message.state);
});

document.getElementById("refresh").addEventListener("click", refresh);
async function setMonitoring(monitoring) {
    if (tabId === null || controlsBusy) return;
    controlsBusy = true;
    render(currentState);
    let error = null;
    try {
        const state = await chrome.runtime.sendMessage({
            type: monitoring ? "START_MONITORING" : "STOP_MONITORING", tabId
        });
        if (state?.error) throw new Error(state.error);
        render(state);
    } catch {
        error = "Unable to change monitoring. Please try again.";
    } finally {
        controlsBusy = false;
        render(currentState);
        if (error) status.textContent = error;
    }
}
document.getElementById("start").addEventListener("click", () => setMonitoring(true));
document.getElementById("stop").addEventListener("click", () => setMonitoring(false));
document.getElementById("copy").addEventListener("click", async () => {
    if (!currentCapture) return;
    try {
        await navigator.clipboard.writeText(currentCapture.mapsUrl);
        status.textContent = "Maps link copied.";
    } catch {
        status.textContent = "Could not copy the Maps link.";
    }
});
document.getElementById("download").addEventListener("click", () => {
    if (!currentCapture) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(currentCapture, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "streetview-latest.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});

(async () => {
    const specified = new URLSearchParams(location.search).get("tabId");
    // The default entry in Chrome's side panel menu binds once to its host page.
    const tab = specified !== null
        ? await chrome.tabs.get(Number(specified))
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab || !Number.isInteger(tab.id)) throw new Error("No page to monitor");
    tabId = tab.id;
    document.getElementById("page").textContent = `Tracking: ${tab.title || "this page"}`;
    await refresh();
})().catch(() => {
    status.textContent = "Open the extension from the toolbar on the page you want to track.";
});
