// Shared helpers for the service worker, the content script and the
// extension pages (popup, confirmation page).
const browserAPI = globalThis.browser ?? globalThis.chrome;

// storage.sync limits a single item to 8 KB, so the user whitelist is spread
// over "whitelist", "whitelist_1", "whitelist_2", ...
const WHITELIST_CHUNK_BYTES = 6000;

function isWhitelistKey(key) {
  return key === "whitelist" || /^whitelist_\d+$/.test(key);
}

function whitelistKeyIndex(key) {
  return key === "whitelist" ? 0 : parseInt(key.split("_")[1], 10);
}

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return "";
  }
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(url || "");
}

// Turns user or admin input ("Example.com", "https://example.com/path",
// "*.example.com") into a canonical whitelist entry, or null if invalid.
function normalizeEntry(input) {
  if (typeof input !== "string") return null;
  let value = input.trim().toLowerCase();
  if (!value) return null;

  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split(/[/?#]/)[0];

  let wildcard = false;
  if (value.startsWith("*.")) {
    wildcard = true;
    value = value.substring(2);
  }
  if (!value || value.includes("*") || value.includes("@")) return null;

  let hostname;
  try {
    hostname = new URL(`http://${value}`).hostname;
  } catch (e) {
    return null;
  }
  hostname = hostname.replace(/\.$/, "");
  if (!hostname) return null;

  return wildcard ? `*.${hostname}` : hostname;
}

function normalizeList(list) {
  if (!Array.isArray(list)) return [];
  const result = [];
  for (const item of list) {
    const entry = normalizeEntry(item);
    if (entry && !result.includes(entry)) result.push(entry);
  }
  return result;
}

function isWhitelisted(domain, whitelist) {
  const host = (domain || "").toLowerCase().replace(/\.$/, "");
  if (!host) return false;

  for (const entry of whitelist) {
    if (entry === host) return true;
    if (entry.startsWith("*.")) {
      // "*.example.com" covers example.com and its subdomains, but not
      // lookalikes such as "evilexample.com".
      const base = entry.substring(2);
      if (host === base || host.endsWith(`.${base}`)) return true;
    }
  }
  return false;
}

function collectUserWhitelist(syncData) {
  const keys = Object.keys(syncData)
    .filter(isWhitelistKey)
    .sort((a, b) => whitelistKeyIndex(a) - whitelistKeyIndex(b));
  const raw = [];
  for (const key of keys) {
    if (Array.isArray(syncData[key])) raw.push(...syncData[key]);
  }
  return normalizeList(raw);
}

async function getUserWhitelist() {
  return collectUserWhitelist(await browserAPI.storage.sync.get(null));
}

async function setUserWhitelist(list) {
  const entries = normalizeList(list);
  const encoder = new TextEncoder();
  const chunks = [[]];
  let size = 2;
  for (const entry of entries) {
    const entrySize = encoder.encode(JSON.stringify(entry)).length + 1;
    if (size + entrySize > WHITELIST_CHUNK_BYTES && chunks.at(-1).length) {
      chunks.push([]);
      size = 2;
    }
    chunks.at(-1).push(entry);
    size += entrySize;
  }

  const data = {};
  chunks.forEach((chunk, index) => {
    data[index === 0 ? "whitelist" : `whitelist_${index}`] = chunk;
  });

  const existing = Object.keys(await browserAPI.storage.sync.get(null));
  await browserAPI.storage.sync.set(data);
  const stale = existing.filter((key) => isWhitelistKey(key) && !(key in data));
  if (stale.length) await browserAPI.storage.sync.remove(stale);
}

// Returns true if the entry was added, false if it was invalid or present.
async function addToUserWhitelist(input) {
  const entry = normalizeEntry(input);
  if (!entry) return false;
  const whitelist = await getUserWhitelist();
  if (whitelist.includes(entry)) return false;
  whitelist.push(entry);
  await setUserWhitelist(whitelist);
  return true;
}

async function removeFromUserWhitelist(entry) {
  const whitelist = await getUserWhitelist();
  await setUserWhitelist(whitelist.filter((item) => item !== entry));
}

// Settings an administrator rolled out via policy (GPO); empty if none.
//
// Right after the browser starts, storage.managed can take several seconds to
// answer. The last known policy is therefore cached, and used if the browser
// has not answered in time. Once the real answer arrives the cache is updated,
// which triggers a re-check through storage.onChanged.
const POLICY_CACHE_KEY = "managedPolicyCache";
const POLICY_WAIT_MS = 250;

async function getManagedPolicy() {
  let cached;
  try {
    cached = (await browserAPI.storage.local.get([POLICY_CACHE_KEY]))[
      POLICY_CACHE_KEY
    ];
  } catch (e) {
    // No cache available
  }

  const fresh = (async () => {
    let policy = {};
    try {
      policy = (await browserAPI.storage.managed.get(null)) || {};
    } catch (e) {
      // No policy support or no policy set
    }
    if (!cached || JSON.stringify(policy) !== JSON.stringify(cached)) {
      browserAPI.storage.local
        .set({ [POLICY_CACHE_KEY]: policy })
        .catch(() => {});
    }
    return policy;
  })();

  if (!cached) return fresh;
  return Promise.race([
    fresh,
    new Promise((resolve) => setTimeout(() => resolve(cached), POLICY_WAIT_MS)),
  ]);
}

function parseUserBlockedCountries(list) {
  const countries = [];
  for (const item of Array.isArray(list) ? list : []) {
    try {
      const country = JSON.parse(item);
      if (country && typeof country.code === "string") countries.push(country);
    } catch (e) {
      // Ignore malformed entries
    }
  }
  return countries;
}

// Effective settings: organization policy combined with the user's own.
async function loadSettings() {
  const [policy, syncData] = await Promise.all([
    getManagedPolicy(),
    browserAPI.storage.sync.get(null),
  ]);

  const managedWhitelist = normalizeList(policy.managedWhitelist);
  const allowUserWhitelist = policy.allowUserWhitelist !== false;
  const userWhitelist = collectUserWhitelist(syncData);

  const locked = {
    enablePreemptiveChecks: typeof policy.enablePreemptiveChecks === "boolean",
    enableCountryBlock: typeof policy.enableCountryBlock === "boolean",
  };

  const managedBlockedCountries = (
    Array.isArray(policy.blockedCountries) ? policy.blockedCountries : []
  )
    .filter((code) => typeof code === "string" && code.trim())
    .map((code) => code.trim().toUpperCase());
  const userBlockedCountries = parseUserBlockedCountries(
    syncData.blockedCountries,
  );

  return {
    managedWhitelist,
    userWhitelist,
    allowUserWhitelist,
    whitelist: allowUserWhitelist
      ? [...managedWhitelist, ...userWhitelist]
      : managedWhitelist,
    locked,
    enablePreemptiveChecks: locked.enablePreemptiveChecks
      ? policy.enablePreemptiveChecks
      : syncData.enablePreemptiveChecks !== false,
    enableCountryBlock: locked.enableCountryBlock
      ? policy.enableCountryBlock
      : syncData.enableCountryBlock !== false,
    managedBlockedCountries,
    userBlockedCountries,
    blockedCountryCodes: [
      ...new Set([
        ...managedBlockedCountries,
        ...userBlockedCountries.map((country) => country.code.toUpperCase()),
      ]),
    ],
  };
}

// True if a storage.onChanged event may have altered the effective settings.
function settingsChanged(changes, areaName) {
  if (areaName === "managed") return true;
  if (areaName === "local") return POLICY_CACHE_KEY in changes;
  if (areaName !== "sync") return false;
  return Object.keys(changes).some(
    (key) =>
      isWhitelistKey(key) ||
      key === "enablePreemptiveChecks" ||
      key === "enableCountryBlock" ||
      key === "blockedCountries",
  );
}
