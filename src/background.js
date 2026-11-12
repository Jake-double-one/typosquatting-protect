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

async function fetchJson(url, headers) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(GEO_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function isIpAddress(hostname) {
  return /^\d+(\.\d+){3}$/.test(hostname) || hostname.includes(":");
}

// Resolves a hostname through Google Public DNS over HTTPS.
async function resolveIpAddress(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIpAddress(host)) return host;

  for (const [type, recordType] of [
    ["A", 1],
    ["AAAA", 28],
  ]) {
    const data = await fetchJson(
      `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=${type}`,
    );
    const record = (data.Answer || []).find((a) => a.type === recordType);
    if (record) return record.data;
  }
  throw new Error("Hostname could not be resolved");
}

// Each lookup returns { country, countryCode, region, city, ip, isp }.
const GEO_LOOKUPS = {
  // HTTPS, detailed
  async ipwhois(hostname) {
    const ip = await resolveIpAddress(hostname);
    const data = await fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}`);
    if (data.success === false) throw new Error(data.message || "Lookup failed");
    return {
      country: data.country,
      countryCode: data.country_code,
      region: data.region,
      city: data.city,
      ip: data.ip || ip,
      isp: data.connection && data.connection.isp,
    };
  },

  // HTTPS; has no country for some shared (anycast) addresses
  async geojs(hostname) {
    const ip = await resolveIpAddress(hostname);
    const data = await fetchJson(
      `https://get.geojs.io/v1/ip/geo/${encodeURIComponent(ip)}.json`,
    );
    return {
      country: data.country,
      countryCode: data.country_code,
      region: data.region,
      city: data.city,
      ip: data.ip || ip,
      isp: data.organization_name,
    };
  },

  // Unencrypted HTTP; the service resolves the domain itself
  async ipapi(hostname) {
    const data = await fetchJson(
      `http://ip-api.com/json/${encodeURIComponent(hostname)}`,
    );
    if (data.status === "fail") throw new Error(data.message || "Lookup failed");
    return {
      country: data.country,
      countryCode: data.countryCode,
      region: data.regionName,
      city: data.city,
      ip: data.query,
      isp: data.isp,
    };
  },
};

async function checkIPGeolocation(url) {
  const settings = await loadSettings();
  if (!settings.enableCountryBlock) {
    return { status: "disabled" };
  }

  try {
    const lookup = GEO_LOOKUPS[settings.geoProvider];
    const data = await lookup(new URL(url).hostname);
    const countryCode =
      typeof data.countryCode === "string" ? data.countryCode.toUpperCase() : "";

    return {
      status: "enabled",
      ...data,
      countryCode,
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
