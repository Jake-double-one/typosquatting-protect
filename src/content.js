// common.js is loaded before this file (see manifest).
let warningBar = null;
// The user closed the bar of a page without an address of its own
let barClosedHere = false;

// The script runs in every frame. Only the top document shows the warning
// bar; the sign-in guard works in all of them.
const IS_TOP_FRAME = window === window.top;

// ---------------------------------------------------------------------------
// The warning bar and the sign-in warning sit in the page they warn about,
// so that page can try to remove, hide or cover them. Their host elements
// are therefore watched: they are put back when removed, their styles are
// restored when changed, and they are kept in the browser's top layer, above
// anything the page can show. A page that keeps fighting this can still make
// a warning flicker, which is why the toolbar icon carries a mark as well
// (see "pageStatus" in background.js).
// ---------------------------------------------------------------------------
const HOST_BASE_STYLE = [
  "all: initial",
  "display: block",
  "position: fixed",
  "margin: 0",
  "padding: 0",
  "border: 0",
  "background: transparent",
  "overflow: visible",
  "visibility: visible",
  "opacity: 1",
  "pointer-events: auto",
  "z-index: 2147483647",
]
  .map((rule) => `${rule} !important`)
  .join("; ");

const RESTORES_PER_SECOND = 20;
const protectedHosts = new Map();
let hostObserver = null;
let hostTimer = null;

function isInTopLayer(host) {
  try {
    return host.matches(":popover-open");
  } catch (e) {
    return false; // browser without popovers
  }
}

// Moves the host to the front of the top layer.
function raiseHost(host) {
  const state = protectedHosts.get(host);
  if (!state || typeof host.showPopover !== "function" || !host.isConnected) return;
  state.raising = true;
  try {
    if (host.getAttribute("popover") !== "manual") host.setAttribute("popover", "manual");
    if (isInTopLayer(host)) host.hidePopover();
    host.showPopover();
  } catch (e) {
    // Not possible in this document; the fixed position and z-index remain.
  }
  state.raising = false;
}

function restoreHost(host) {
  const state = protectedHosts.get(host);
  const parent = document.documentElement;
  if (!state || !parent) return;
  if (host.parentNode !== parent) parent.appendChild(host);
  if (host.getAttribute("style") !== state.style) host.setAttribute("style", state.style);
  if (!isInTopLayer(host)) raiseHost(host);
}

// Restores at once, but not endlessly: a page that removes the host in a
// loop must not be able to freeze the tab. The timer picks it up again.
function restoreHostLimited(host) {
  const state = protectedHosts.get(host);
  if (!state) return;
  const now = Date.now();
  state.restores = state.restores.filter((time) => now - time < 1000);
  if (state.restores.length >= RESTORES_PER_SECOND) return;
  state.restores.push(now);
  restoreHost(host);
}

function needsRestore(host) {
  const state = protectedHosts.get(host);
  return (
    host.parentNode !== document.documentElement ||
    host.getAttribute("style") !== state.style ||
    (typeof host.showPopover === "function" && !isInTopLayer(host))
  );
}

function checkHosts() {
  for (const host of protectedHosts.keys()) {
    if (needsRestore(host)) restoreHostLimited(host);
  }
}

// True if the page shows something of its own in the top layer or covers
// the host there.
function isCovered(host) {
  let others = [];
  try {
    others = [...document.querySelectorAll(":popover-open, dialog:modal, :fullscreen")];
  } catch (e) {
    // Selector not supported
  }
  if (others.some((element) => !protectedHosts.has(element))) return true;
  const rect = host.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  const x = rect.left + Math.min(rect.width / 2, 40);
  const y = rect.top + rect.height / 2;
  if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false;
  const top = document.elementFromPoint(x, y);
  return Boolean(top && top !== host && !protectedHosts.has(top));
}

function watchHosts() {
  if (!hostObserver) {
    hostObserver = new MutationObserver(() => {
      // The page may have replaced the whole document element
      if (document.documentElement) {
        hostObserver.observe(document.documentElement, { childList: true });
      }
      checkHosts();
    });
  }
  hostObserver.observe(document, { childList: true });
  if (document.documentElement) {
    hostObserver.observe(document.documentElement, { childList: true });
  }
  for (const [host, state] of protectedHosts) {
    state.attributes.observe(host, { attributes: true });
  }
  if (!hostTimer) {
    hostTimer = setInterval(() => {
      for (const host of protectedHosts.keys()) {
        restoreHost(host);
        if (isCovered(host)) raiseHost(host);
      }
    }, 1000);
  }
}

// Starts watching `host`; `style` holds its position (the rest is fixed).
function protectHost(host, style) {
  const state = {
    style: "",
    raising: false,
    restores: [],
    attributes: new MutationObserver(() => {
      if (needsRestore(host)) restoreHostLimited(host);
    }),
  };
  protectedHosts.set(host, state);
  setHostStyle(host, style);
  restoreHost(host);
  watchHosts();
}

function setHostStyle(host, style) {
  const state = protectedHosts.get(host);
  if (!state) return;
  host.setAttribute("style", `${HOST_BASE_STYLE}; ${style}`);
  state.style = host.getAttribute("style");
}

function unprotectHost(host) {
  const state = protectedHosts.get(host);
  if (!state) return;
  state.attributes.disconnect();
  protectedHosts.delete(host);
  if (protectedHosts.size === 0) {
    if (hostObserver) hostObserver.disconnect();
    clearInterval(hostTimer);
    hostTimer = null;
  }
  host.remove();
}

// Registered before any page script runs (document_start), so these
// listeners come first. The page gets no say in whether a host is shown, and
// when it opens something in the top layer, the hosts move back to the front.
function onTopLayerEvent(event) {
  const state = protectedHosts.get(event.target);
  if (state) {
    event.stopImmediatePropagation();
    if (event.type === "toggle" && !state.raising && !isInTopLayer(event.target)) {
      restoreHostLimited(event.target);
    }
    return;
  }
  if (event.type === "beforetoggle") return;
  // <details> elements fire "toggle" too, but do not enter the top layer
  if (event.type === "toggle" && !event.target.matches?.("[popover], dialog")) return;
  for (const host of protectedHosts.keys()) raiseHost(host);
}
window.addEventListener("beforetoggle", onTopLayerEvent, true);
window.addEventListener("toggle", onTopLayerEvent, true);
window.addEventListener("fullscreenchange", onTopLayerEvent, true);

// The page is moved down by the height of the bar, so the bar does not cover
// the top of the page. The previous inline value is restored afterwards.
let savedPageMargin = null;
let barResizeObserver = null;

function reserveSpaceForBar(bar) {
  const html = document.documentElement;
  if (savedPageMargin === null) {
    savedPageMargin = {
      value: html.style.getPropertyValue("margin-top"),
      priority: html.style.getPropertyPriority("margin-top"),
    };
  }
  const apply = () => {
    if (!bar.isConnected) return;
    html.style.setProperty("margin-top", `${bar.offsetHeight}px`, "important");
  };
  apply();
  // The bar gets taller when its text wraps in a narrow window.
  barResizeObserver = new ResizeObserver(apply);
  barResizeObserver.observe(bar);
}

function releaseSpaceForBar() {
  if (barResizeObserver) {
    barResizeObserver.disconnect();
    barResizeObserver = null;
  }
  if (savedPageMargin === null) return;
  const html = document.documentElement;
  if (savedPageMargin.value) {
    html.style.setProperty("margin-top", savedPageMargin.value, savedPageMargin.priority);
  } else {
    html.style.removeProperty("margin-top");
  }
  savedPageMargin = null;
}

function removeWarningBar() {
  if (warningBar) {
    unprotectHost(warningBar);
    warningBar.remove();
    warningBar = null;
  }
  releaseSpaceForBar();
}

// The bar lives in a closed shadow root: page scripts can neither read its
// text nor reach its button. (The browser tests switch this to "open".)
const BAR_SHADOW_MODE = "closed";

const BAR_STYLES = `
  .bar {
    box-sizing: border-box;
    width: 100%;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 20px;
    background-color: #ff5252;
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    text-align: left;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  }
  .warning-text { flex-grow: 1; min-width: 0; }
  strong { font-weight: bold; }
  .hint { opacity: 0.9; }
  button {
    flex-shrink: 0;
    background: none;
    border: none;
    color: #fff;
    font-size: 20px;
    line-height: 1;
    padding: 0 5px;
    cursor: pointer;
  }
  .slim {
    padding: 2px 10px;
    font-size: 12px;
    line-height: 1.4;
    gap: 6px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  }
  .slim .warning-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .slim button { font-size: 15px; padding: 0 3px; }
`;

// `domain` is empty for a page without an address of its own (see
// getPageContext); such a page cannot be whitelisted or looked up.
async function createWarningBar(domain, allowUserWhitelist, homograph, size) {
  removeWarningBar();
  if (!domain && barClosedHere) return;

  // The host element is all the page can see.
  const host = document.createElement("div");
  host.id = "whitelist-warning-bar";
  warningBar = host;
  const root = host.attachShadow({ mode: BAR_SHADOW_MODE });

  const style = document.createElement("style");
  style.textContent = BAR_STYLES;
  const bar = document.createElement("div");
  bar.className = size === "slim" ? "bar slim" : "bar";
  root.append(style, bar);

  const text = document.createElement("span");
  text.className = "warning-text";
  const strong = document.createElement("strong");
  strong.textContent = domain || t("unknownContent");
  text.append(t("barBefore"), strong, t("barAfter"));
  if (homograph) {
    const alert = document.createElement("strong");
    alert.textContent = homograph.imitates
      ? t("barHomographImitates", [homograph.imitates])
      : t("barHomograph");
    text.appendChild(alert);
  }
  bar.appendChild(text);

  let info = null;
  if (domain) {
    try {
      info = await browserAPI.runtime.sendMessage({
        action: "domainInfo",
        hostname: domain,
      });
    } catch (e) {
      // Extension was reloaded; show the bar without the extras.
    }
  }

  if (!homograph && info && info.similarTo) {
    const alert = document.createElement("strong");
    alert.textContent = t("barSimilar", [info.similarTo]);
    text.appendChild(alert);
  }

  const suspicious = Boolean(homograph || (info && info.similarTo));

  // The user closed the bar for this website in this tab. Suspicious
  // domains show it again on every page.
  if (info && info.barDismissed && !suspicious) {
    if (warningBar === host) warningBar = null;
    return;
  }

  // Whitelisting happens only in the extension's own pages, which a website
  // cannot reach. The bar just points there.
  if (domain && allowUserWhitelist && !suspicious) {
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = ` · ${t("barHint")}`;
    text.appendChild(hint);
  }

  const closeButton = document.createElement("button");
  closeButton.id = "close-warning-btn";
  closeButton.textContent = "×";
  closeButton.title = t("barClose");
  closeButton.addEventListener("click", () => {
    // Without a domain the background cannot remember the choice
    if (!domain) barClosedHere = true;
    removeWarningBar();
    browserAPI.runtime.sendMessage({ action: "dismissBar" }).catch(() => {});
  });
  bar.appendChild(closeButton);

  // A newer check may have replaced or dismissed this bar in the meantime.
  if (warningBar === host && document.documentElement) {
    protectHost(host, "top: 0 !important; left: 0 !important; width: 100% !important");
    reserveSpaceForBar(host);
  }
}

// ---------------------------------------------------------------------------
// Sign-in guard: warns when the user types a company e-mail address (or one
// of their own sign-in names) into a field on a non-whitelisted page.
// ---------------------------------------------------------------------------
let protectedLogins = [];
let protectedEmailDomains = [];
let loginWarning = null;
let loginWarningField = null;
const markedFields = new Set();

// Everything the user can type a sign-in name into. The `type` property is
// used, not the attribute: the browser treats an unknown type as text.
function isTextField(element) {
  if (element instanceof HTMLInputElement) {
    return ["text", "email", "search", "tel", "url"].includes(element.type);
  }
  return element instanceof HTMLTextAreaElement || element.isContentEditable === true;
}

function fieldText(field) {
  return typeof field.value === "string" ? field.value : field.textContent || "";
}

// The shadow root of an element, also a closed one (extensions may look).
function shadowRootOf(element) {
  try {
    if (globalThis.chrome?.dom?.openOrClosedShadowRoot) {
      return chrome.dom.openOrClosedShadowRoot(element);
    }
    return element.openOrClosedShadowRoot || element.shadowRoot || null;
  } catch (e) {
    return null;
  }
}

// The fields an input event came from. For a field inside a closed shadow
// root the event only names the outer element, so the focused element
// inside is looked up. When none has the focus (the browser filled the
// field in, or the field was just left), all fields in there are returned.
// An editable region counts as one field.
function findEventFields(event) {
  let node = event.composedPath ? event.composedPath()[0] : event.target;
  for (let depth = 0; node && depth < 10; depth++) {
    const root = shadowRootOf(node);
    if (!root) break;
    if (!root.activeElement) {
      return [...root.querySelectorAll("input, textarea, [contenteditable]")].filter(isTextField);
    }
    node = root.activeElement;
  }
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return [];
  while (node.isContentEditable && node.parentElement?.isContentEditable) {
    node = node.parentElement;
  }
  return [node];
}

function markField(field) {
  if (markedFields.has(field)) return;
  markedFields.add(field);
  field.style.setProperty("outline", "3px solid #d50000", "important");
  field.style.setProperty("outline-offset", "1px", "important");
  field.style.setProperty("background-color", "#ffebee", "important");
  field.style.setProperty("color", "#000", "important");
}

function unmarkField(field) {
  if (!markedFields.delete(field)) return;
  for (const property of ["outline", "outline-offset", "background-color", "color"]) {
    field.style.removeProperty(property);
  }
}

function positionLoginWarning() {
  if (!loginWarning || !loginWarningField) return;
  if (!loginWarningField.isConnected) {
    hideLoginWarning();
    return;
  }
  const rect = loginWarningField.getBoundingClientRect();
  const width = Math.min(360, window.innerWidth - 16);
  // The size must be known before the place is chosen
  setHostStyle(loginWarning, `width: ${width}px !important; left: 0 !important; top: 0 !important`);

  // Prefer a spot beside or above the field so the fields below stay visible
  const height = loginWarning.offsetHeight;
  let left;
  let top;
  if (rect.right + 10 + width <= window.innerWidth - 8) {
    left = rect.right + 10;
    top = rect.top;
  } else {
    left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    top = rect.top - height - 6 >= 0 ? rect.top - height - 6 : rect.bottom + 6;
  }
  setHostStyle(
    loginWarning,
    `width: ${width}px !important; left: ${left}px !important; top: ${top}px !important`,
  );
}

const LOGIN_WARNING_STYLES = `
  .warning {
    box-sizing: border-box;
    background-color: #d50000;
    color: #fff;
    border: 2px solid #7f0000;
    border-radius: 6px;
    padding: 10px 12px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      Helvetica, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.4;
    text-align: left;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  }
  strong { display: block; font-size: 14px; font-weight: bold; margin-bottom: 3px; }
`;

function showLoginWarning(field) {
  if (!loginWarning) {
    // Like the warning bar, the text lives in a closed shadow root.
    loginWarning = document.createElement("div");
    loginWarning.id = "whitelist-login-warning";
    const root = loginWarning.attachShadow({ mode: BAR_SHADOW_MODE });
    const style = document.createElement("style");
    style.textContent = LOGIN_WARNING_STYLES;
    const box = document.createElement("div");
    box.className = "warning";
    box.setAttribute("role", "alert");
    const title = document.createElement("strong");
    title.textContent = t("loginWarningTitle");
    const text = document.createElement("span");
    text.textContent = t("loginWarningText", [pageLabel]);
    box.append(title, text);
    root.append(style, box);
  }
  loginWarningField = field;
  if (!protectedHosts.has(loginWarning)) protectHost(loginWarning, "left: 0 !important; top: 0 !important");
  positionLoginWarning();
}

function hideLoginWarning() {
  if (loginWarning) {
    unprotectHost(loginWarning);
    loginWarning.remove();
    // Built again next time: the page name may have changed
    loginWarning = null;
  }
  loginWarningField = null;
}

function clearLoginGuard() {
  [...markedFields].forEach(unmarkField);
  hideLoginWarning();
}

// True for "name@example.com" if example.com (or a parent of the address's
// domain) is one of the organization's e-mail domains.
function isCompanyEmail(value) {
  const match = /^[^\s@]+@([^\s@]+)$/.exec(value);
  if (!match) return false;
  const domain = match[1].replace(/\.$/, "");
  return protectedEmailDomains.some(
    (company) => domain === company || domain.endsWith(`.${company}`),
  );
}

function isLoginGuardActive() {
  return protectedLogins.length > 0 || protectedEmailDomains.length > 0;
}

function checkField(field) {
  if (!isLoginGuardActive() || !isTextField(field)) return;
  const value = fieldText(field).trim().toLowerCase();

  if (value && (protectedLogins.includes(value) || isCompanyEmail(value))) {
    markField(field);
    showLoginWarning(field);
    // The password usually follows: mark those fields as well
    document.querySelectorAll('input[type="password"]').forEach(markField);
  } else if (markedFields.has(field)) {
    unmarkField(field);
    if (loginWarningField === field) {
      hideLoginWarning();
      document.querySelectorAll('input[type="password"]').forEach(unmarkField);
    }
  }
}

// Fields are checked only when the user types into them (or the browser
// fills them in). Events a page creates by script are ignored, and fields the
// user has not touched are never checked: otherwise a page could fill in
// guesses and read from the red marking which ones are company addresses.
async function onFieldEvent(event) {
  if (!event.isTrusted) return;
  const fields = findEventFields(event);
  if (!fields.length) return;
  // Frames learn whether they are guarded when the user first types in them
  if (!guardReady) await checkDomainOnce();
  fields.forEach(checkField);
}

// On window, and registered before any page script runs: a page listener
// cannot swallow the event first.
window.addEventListener("input", onFieldEvent, true);
window.addEventListener("change", onFieldEvent, true);
window.addEventListener("scroll", positionLoginWarning, true);
window.addEventListener("resize", positionLoginWarning);

// The website this page belongs to. about:blank and about:srcdoc pages,
// which a website can fill with its own content, count as that website.
function getPageDomain() {
  return getWebDomain(window.location.href) || getWebDomain(self.origin);
}

// Which website this document is checked as:
//   { domain }        a website
//   { domain: "" }    web content without an address of its own: a blob:,
//                     data: or about: document with an opaque origin, as a
//                     sandboxed frame creates it. Treated as not whitelisted.
//   null              a browser, extension or file page: not checked
async function getPageContext() {
  const domain = getPageDomain();
  if (domain) return { domain };
  if (self.origin !== "null" || !/^(blob|data|about):$/.test(window.location.protocol)) {
    return null;
  }
  // A frame without an address belongs to the page that embeds it
  if (!IS_TOP_FRAME) {
    const ancestors = window.location.ancestorOrigins;
    for (const origin of ancestors || []) {
      const ancestor = getWebDomain(origin);
      if (ancestor) return { domain: ancestor };
    }
    if (!ancestors) {
      // Browsers that do not tell a frame its ancestors: use the tab's page
      try {
        const tab = await browserAPI.runtime.sendMessage({ action: "tabDomain" });
        if (tab && tab.domain) return { domain: tab.domain };
      } catch (e) {
        // Extension was reloaded
      }
    }
  }
  return { domain: "" };
}

// Name of the page in the sign-in warning
let pageLabel = "";
// False until this document knows whether the sign-in guard applies to it
let guardReady = false;

function reportPageStatus(warned) {
  if (!IS_TOP_FRAME) return;
  browserAPI.runtime.sendMessage({ action: "pageStatus", warned }).catch(() => {});
}

// One check at a time for input events that arrive before the first result
let pendingCheck = null;
function checkDomainOnce() {
  if (!pendingCheck) {
    pendingCheck = checkDomain().finally(() => {
      pendingCheck = null;
    });
  }
  return pendingCheck;
}

async function checkDomain() {
  const context = await getPageContext();
  if (!context) {
    guardReady = true;
    return;
  }
  const currentDomain = context.domain;
  const settings = await loadSettings();
  guardReady = true;
  pageLabel = currentDomain || t("unknownContent");

  if (currentDomain && isWhitelisted(currentDomain, settings.whitelist)) {
    removeWarningBar();
    protectedLogins = [];
    protectedEmailDomains = [];
    clearLoginGuard();
    reportPageStatus(false);
  } else {
    protectedLogins = settings.protectedLogins;
    protectedEmailDomains = settings.protectedEmailDomains;
    // The mark on the toolbar icon belongs to the bar and follows its switch
    reportPageStatus(settings.enableWarningBar);
    if (settings.enableWarningBar && IS_TOP_FRAME) {
      createWarningBar(
        currentDomain,
        settings.allowUserWhitelist,
        currentDomain ? analyzeHomograph(currentDomain, settings.whitelist) : null,
        settings.warningBarSize,
      );
    } else {
      removeWarningBar();
    }
  }
}

// The top document is checked as soon as it can show the bar. Frames wait
// until the user types into one of their fields (see onFieldEvent), so
// pages with many frames cost nothing extra.
if (IS_TOP_FRAME) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkDomain);
  } else {
    checkDomain();
  }
}

// React to whitelist changes made by the user or by organization policy
browserAPI.storage.onChanged.addListener((changes, areaName) => {
  if (!settingsChanged(changes, areaName)) return;
  if (IS_TOP_FRAME ? document.body : guardReady) checkDomain();
});
