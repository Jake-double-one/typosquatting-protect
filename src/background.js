// Chromium loads the helpers here; Firefox lists common.js in its manifest.
if (typeof loadSettings === "undefined") {
  importScripts("common.js");
}

const EXTENSION_ORIGIN = browserAPI.runtime.getURL("");
const CONFIRMATION_URL = browserAPI.runtime.getURL("confirmation.html");
const GEO_TIMEOUT_MS = 5000;

// Domains the user allowed "just for now". Kept in session storage because
// the service worker is stopped when idle and loses its variables.
async function getSessionAllowedDomains() {
  const result = await browserAPI.storage.session.get(["sessionAllowedDomains"]);
  return result.sessionAllowedDomains || [];
}

async function allowDomainForSession(domain) {
  const domains = await getSessionAllowedDomains();
  if (domain && !domains.includes(domain)) {
    domains.push(domain);
    await browserAPI.storage.session.set({ sessionAllowedDomains: domains });
  }
}

browserAPI.webNavigation.onCommitted.addListener((details) => {
  // Only check main frame navigations
  if (details.frameId === 0) {
    checkTabNavigation(details.tabId, details.url);
  }
});

async function checkIPGeolocation(url) {
  const settings = await loadSettings();
  if (!settings.enableCountryBlock) {
    return { status: "disabled" };
  }

  try {
    const hostname = new URL(url).hostname;
    const response = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(hostname)}`,
      { signal: AbortSignal.timeout(GEO_TIMEOUT_MS) },
    );
    const data = await response.json();
    const countryCode =
      typeof data.countryCode === "string" ? data.countryCode.toUpperCase() : "";

    return {
      status: "enabled",
      country: data.country,
      countryCode,
      region: data.regionName,
      city: data.city,
      ip: data.query,
      isp: data.isp,
      risk: settings.blockedCountryCodes.includes(countryCode) ? "High" : "Low",
    };
  } catch (error) {
    return { error: "Geolocation lookup failed" };
  }
}

// Registrable domain ("example.co.uk" for "www.example.co.uk"), used for the
// wildcard suggestion. Null when there is none (IP addresses, "localhost").
function getRootDomain(hostname) {
  const host = (hostname || "").toLowerCase().replace(/\.$/, "");
  if (!host || !host.includes(".") || host.includes(":")) return null;
  if (/^\d+(\.\d+){3}$/.test(host)) return null;

  if (browserAPI.publicSuffix?.getDomain) {
    try {
      // allowUnknownSuffix keeps internal names like "wiki.corp.internal" usable
      return (
        browserAPI.publicSuffix.getDomain(host, { allowUnknownSuffix: true }) ||
        null
      );
    } catch (e) {
      return null;
    }
  }

  // Browsers without the publicSuffix API: last two labels.
  return host.split(".").slice(-2).join(".");
}

async function checkTabNavigation(tabId, url) {
  // Only web pages are checked; browser, extension and file pages are not.
  if (!isHttpUrl(url)) return;

  const domain = getDomain(url);
  if (!domain) return;

  const settings = await loadSettings();
  if (!settings.enablePreemptiveChecks) return;
  if (isWhitelisted(domain, settings.whitelist)) return;
  if ((await getSessionAllowedDomains()).includes(domain)) return;

  browserAPI.tabs.update(tabId, {
    url: `${CONFIRMATION_URL}?domain=${encodeURIComponent(domain)}&url=${encodeURIComponent(url)}`,
  });
}

async function handleMessage(message, sender) {
  const fromExtensionPage =
    typeof sender.url === "string" && sender.url.startsWith(EXTENSION_ORIGIN);
  const fromConfirmation =
    fromExtensionPage && sender.url.startsWith(CONFIRMATION_URL) && sender.tab;

  switch (message.action) {
    case "getRootDomain":
      return { rootDomain: await getRootDomain(message.hostname) };

    case "confirmationInfo": {
      if (!fromConfirmation) return {};
      const settings = await loadSettings();
      return {
        rootDomain: await getRootDomain(message.domain),
        allowUserWhitelist: settings.allowUserWhitelist,
      };
    }

    case "securityCheck":
      if (!fromConfirmation) return {};
      return { geo: await checkIPGeolocation(message.url) };

    case "continueNavigation":
      if (!fromConfirmation || !isHttpUrl(message.url)) return {};
      await allowDomainForSession(getDomain(message.url));
      await browserAPI.tabs.update(sender.tab.id, { url: message.url });
      return {};

    case "whitelistAndContinue": {
      if (!fromConfirmation || !isHttpUrl(message.url)) return {};
      const settings = await loadSettings();
      const entry = normalizeEntry(message.domain);
      // The entry must cover the page that is being opened.
      if (
        settings.allowUserWhitelist &&
        entry &&
        isWhitelisted(getDomain(message.url), [entry])
      ) {
        await addToUserWhitelist(entry);
        await browserAPI.tabs.update(sender.tab.id, { url: message.url });
      }
      return {};
    }

    case "exitNavigation":
      if (fromConfirmation) await browserAPI.tabs.remove(sender.tab.id);
      return {};

    case "togglePreemptiveChecks":
    case "toggleCountryBlock": {
      if (!fromExtensionPage) return {};
      const key =
        message.action === "togglePreemptiveChecks"
          ? "enablePreemptiveChecks"
          : "enableCountryBlock";
      const settings = await loadSettings();
      if (!settings.locked[key]) {
        await browserAPI.storage.sync.set({ [key]: Boolean(message.enabled) });
      }
      return {};
    }

    default:
      return {};
  }
}

browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || sender.id !== browserAPI.runtime.id) return false;
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ error: error.message }));
  return true;
});
