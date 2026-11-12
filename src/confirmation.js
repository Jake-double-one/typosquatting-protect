// common.js is loaded before this file (see confirmation.html).
document.addEventListener("DOMContentLoaded", async function () {
  const urlParams = new URLSearchParams(window.location.search);
  const domain = urlParams.get("domain");
  const url = urlParams.get("url");

  document.getElementById("domain-name").textContent = domain;

  const whitelistButton = document.getElementById("whitelist-continue");
  const wildcardButton = document.getElementById("wildcard-continue");
  const continueButton = document.getElementById("just-continue");
  let wildcardDomain = null;

  whitelistButton.addEventListener("click", function () {
    browserAPI.runtime.sendMessage({
      action: "whitelistAndContinue",
      domain: domain,
      url: url,
    });
  });

  wildcardButton.addEventListener("click", function () {
    if (!wildcardDomain) return;
    browserAPI.runtime.sendMessage({
      action: "whitelistAndContinue",
      domain: wildcardDomain,
      url: url,
    });
  });

  continueButton.addEventListener("click", function () {
    browserAPI.runtime.sendMessage({
      action: "continueNavigation",
      url: url,
    });
  });

  document.getElementById("exit-page").addEventListener("click", function () {
    browserAPI.runtime.sendMessage({ action: "exitNavigation" });
  });

  // Whitelisting options depend on the organization policy
  const info = await browserAPI.runtime.sendMessage({
    action: "confirmationInfo",
    domain: domain,
  });
  if (info && info.allowUserWhitelist === false) {
    whitelistButton.remove();
    wildcardButton.remove();
    document.getElementById("managed-note").hidden = false;
  } else if (info && info.rootDomain) {
    wildcardDomain = `*.${info.rootDomain}`;
    wildcardButton.textContent = `Whitelist ${wildcardDomain} and Continue`;
  } else {
    wildcardButton.remove();
  }

  // Geolocation details
  const response = await browserAPI.runtime.sendMessage({
    action: "securityCheck",
    url: url,
  });
  renderGeo(response && response.geo);

  function addParagraph(parent, build) {
    const p = document.createElement("p");
    build(p);
    parent.appendChild(p);
  }

  function renderGeo(geo) {
    const details = document.getElementById("security-details");
    details.textContent = "";
    if (!geo) return;

    if (geo.status === "disabled") {
      addParagraph(details, (p) => {
        p.textContent = "Geolocation checks disabled";
      });
      return;
    }

    if (geo.status !== "enabled") {
      addParagraph(details, (p) => {
        p.textContent = "Geolocation lookup failed";
      });
      return;
    }

    if (geo.risk === "High") {
      document.getElementById("icon").textContent = "❗";
      document.getElementById("title").textContent = "Blocked Country";
      addParagraph(details, (p) => {
        const strong = document.createElement("strong");
        strong.textContent = "Geographical Risk Warning";
        p.append(
          strong,
          document.createElement("br"),
          "This domain originates from a blocked country.",
        );
      });
      wildcardButton.remove();
      continueButton.remove();
    }

    addParagraph(details, (p) => {
      const heading = document.createElement("strong");
      heading.textContent = "Geolocation:";
      p.appendChild(heading);
      const rows = [
        ["Country", geo.country],
        ["Region", geo.region],
        ["IP", geo.ip],
        ["ISP", geo.isp],
      ];
      for (const [label, value] of rows) {
        p.append(document.createElement("br"), `${label}: ${value || "Unknown"}`);
      }
      const risk = document.createElement("strong");
      risk.textContent = geo.risk || "Unknown";
      p.append(document.createElement("br"), "Risk Level: ", risk);
    });
  }
});
