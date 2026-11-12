// common.js is loaded before this file (see manifest).
let warningBar = null;

function removeWarningBar() {
  if (warningBar) {
    warningBar.remove();
    warningBar = null;
  }
}

function createButton(id, label, onClick) {
  const button = document.createElement("button");
  button.id = id;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

async function createWarningBar(domain, allowUserWhitelist) {
  removeWarningBar();

  const bar = document.createElement("div");
  bar.id = "whitelist-warning-bar";
  warningBar = bar;

  const text = document.createElement("span");
  text.className = "warning-text";
  const strong = document.createElement("strong");
  strong.textContent = domain;
  text.append("⚠️ Non-whitelisted domain: ", strong, " could be insecure");
  bar.appendChild(text);

  if (allowUserWhitelist) {
    bar.appendChild(
      createButton("whitelist-btn", "Whitelist this domain", async () => {
        await addToUserWhitelist(domain);
        removeWarningBar();
      }),
    );

    let rootDomain = null;
    try {
      const response = await browserAPI.runtime.sendMessage({
        action: "getRootDomain",
        hostname: domain,
      });
      rootDomain = response && response.rootDomain;
    } catch (e) {
      // Extension was reloaded; show the bar without the wildcard option.
    }
    if (rootDomain) {
      const wildcardDomain = `*.${rootDomain}`;
      bar.appendChild(
        createButton(
          "wildcard-whitelist-btn",
          `Whitelist ${wildcardDomain}`,
          async () => {
            await addToUserWhitelist(wildcardDomain);
            removeWarningBar();
          },
        ),
      );
    }
  }

  bar.appendChild(createButton("close-warning-btn", "×", removeWarningBar));

  // A newer check may have replaced or dismissed this bar in the meantime.
  if (warningBar === bar && document.body) {
    document.body.insertBefore(bar, document.body.firstChild);
  }
}

async function checkDomain() {
  if (!isHttpUrl(window.location.href)) return;
  const currentDomain = getDomain(window.location.href);
  const settings = await loadSettings();

  if (isWhitelisted(currentDomain, settings.whitelist)) {
    removeWarningBar();
  } else {
    createWarningBar(currentDomain, settings.allowUserWhitelist);
  }
}

// Wait for the DOM to be ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", checkDomain);
} else {
  checkDomain();
}

// React to whitelist changes made by the user or by organization policy
browserAPI.storage.onChanged.addListener((changes, areaName) => {
  if (settingsChanged(changes, areaName) && document.body) {
    checkDomain();
  }
});
