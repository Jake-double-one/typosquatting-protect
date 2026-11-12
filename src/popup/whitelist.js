function sortDomains(list) {
  return [...list].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

function createBadge(className, label) {
  const badge = document.createElement("span");
  badge.className = className;
  badge.textContent = label;
  return badge;
}

function renderDomainList(element, domains, { emptyText, onRemove }) {
  element.textContent = "";

  if (domains.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-list";
    empty.textContent = emptyText;
    element.appendChild(empty);
    return;
  }

  sortDomains(domains).forEach(function (domain) {
    const li = document.createElement("li");

    const domainEntry = document.createElement("div");
    domainEntry.className = "domain-entry";
    domainEntry.appendChild(document.createTextNode(domain));
    if (domain.startsWith("*.")) {
      domainEntry.appendChild(createBadge("wildcard-badge", t("badgeWildcard")));
    }
    li.appendChild(domainEntry);

    if (onRemove) {
      const removeButton = document.createElement("button");
      removeButton.textContent = t("remove");
      removeButton.className = "remove-btn";
      removeButton.addEventListener("click", function () {
        onRemove(domain);
      });
      li.appendChild(removeButton);
    } else {
      li.appendChild(createBadge("managed-badge", t("badgeManaged")));
    }

    element.appendChild(li);
  });
}

async function loadWhitelist() {
  const settings = await loadSettings();

  // Domains rolled out by the organization: visible, but not editable
  document.getElementById("managed-section").hidden =
    settings.managedWhitelist.length === 0;
  renderDomainList(
    document.getElementById("managed-whitelist"),
    settings.managedWhitelist,
    { emptyText: "" },
  );

  document.getElementById("user-section").hidden = !settings.allowUserWhitelist;
  document.getElementById("user-whitelist-locked").hidden =
    settings.allowUserWhitelist;
  const redundant = settings.allowUserWhitelist
    ? findRedundantEntries(settings.userWhitelist, settings.managedWhitelist)
    : [];
  document.getElementById("redundant-note").hidden = redundant.length === 0;
  document.getElementById("redundant-text").textContent = t("redundantNote", [
    String(redundant.length),
  ]);

  renderDomainList(document.getElementById("whitelist"), settings.userWhitelist, {
    emptyText: t("emptyWhitelist"),
    onRemove: removeDomain,
  });
}

async function addEntry(input) {
  const entry = normalizeEntry(input);
  if (!entry) {
    alert(t("alertInvalidDomain"));
    return false;
  }

  // Adding a domain that looks like a trusted one needs explicit confirmation
  let suspicion = null;
  try {
    const info = await browserAPI.runtime.sendMessage({
      action: "domainInfo",
      hostname: entry.replace(/^\*\./, ""),
    });
    suspicion = info && info.suspicion;
  } catch (e) {
    // Background not reachable; add without the extra check
  }
  if (suspicion && !confirm(t("confirmSuspicious", [entry, suspicion]))) {
    return false;
  }
  if (!(await addToUserWhitelist(entry))) {
    alert(t("alertAlreadyListed"));
    return false;
  }
  loadWhitelist();
  return true;
}

async function addDomain() {
  const input = document.getElementById("new-domain");
  if (!input.value.trim()) {
    return;
  }
  await addEntry(input.value);
  input.value = "";
}

async function addCurrentDomain() {
  const tabs = await browserAPI.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (tabs[0] && isHttpUrl(tabs[0].url)) {
    await addEntry(getDomain(tabs[0].url));
  } else {
    alert(t("alertNotWebPage"));
  }
}

// Removes entries that other entries already cover; the protection is unchanged
async function cleanUpRedundantEntries() {
  const settings = await loadSettings();
  const redundant = findRedundantEntries(
    settings.userWhitelist,
    settings.managedWhitelist,
  );
  await setUserWhitelist(
    settings.userWhitelist.filter((entry) => !redundant.includes(entry)),
  );
  loadWhitelist();
}

async function removeDomain(domain) {
  await removeFromUserWhitelist(domain);
  loadWhitelist();
}
