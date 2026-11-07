chrome.devtools.panels.create(
    "Streetview Capture", "", `panel.html?tabId=${chrome.devtools.inspectedWindow.tabId}`, () => {}
);
