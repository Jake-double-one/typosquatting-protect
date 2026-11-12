// Prepares a self-hosted enterprise rollout for Chrome and Edge:
//   - the extension folder to pack (with the update URL built in)
//   - update.xml for the internal web server
//   - Group Policy templates (ADMX/ADML) for the extension's settings
//   - a text file with the exact values to enter in the GPO
//
// Usage:
//   node scripts/enterprise.js --url <https://server/path> (--key <key.pem> | --id <extension id>)
//
// With --key, the key file is created on first use.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { validateSource, buildDirectories, CHROME_DIR, DIST_DIR } = require("./build");

const OUT_DIR = path.join(DIST_DIR, "enterprise");
const PACKAGE_NAME = "domain-whitelist-protector";
const ADMX_NAME = "DomainWhitelistProtector";

const BROWSERS = [
  {
    prefix: "Chrome",
    label: "Google Chrome",
    policyRoot: "Software\\Policies\\Google\\Chrome",
  },
  {
    prefix: "Edge",
    label: "Microsoft Edge",
    policyRoot: "Software\\Policies\\Microsoft\\Edge",
  },
];

// name: policy name in managed_schema.json; type: "list" or "boolean"
const POLICIES = [
  {
    name: "managedWhitelist",
    type: "list",
    en: {
      title: "Organization whitelist",
      listLabel: "Whitelisted domains",
      explain:
        "Domains that are always whitelisted for all users. Enter one domain per line.\n\nExamples:\n  example.com\n  *.sharepoint.com\n\nAn entry starting with *. covers the domain and all of its subdomains. Users see these entries in the extension but cannot remove them.",
    },
    de: {
      title: "Firmen-Whitelist",
      listLabel: "Erlaubte Domains",
      explain:
        "Domains, die für alle Benutzer immer erlaubt sind. Eine Domain pro Zeile eintragen.\n\nBeispiele:\n  example.com\n  *.sharepoint.com\n\nEin Eintrag, der mit *. beginnt, gilt für die Domain und alle ihre Subdomains. Benutzer sehen diese Einträge in der Erweiterung, können sie aber nicht entfernen.",
    },
  },
  {
    name: "allowUserWhitelist",
    type: "boolean",
    en: {
      title: "Allow users to whitelist their own domains",
      explain:
        "Enabled or not configured: users can add their own domains in addition to the organization whitelist.\n\nDisabled: only the organization whitelist applies. Users can still open other websites after confirming the warning, but cannot whitelist them.",
    },
    de: {
      title: "Benutzer dürfen eigene Domains erlauben",
      explain:
        "Aktiviert oder nicht konfiguriert: Benutzer können zusätzlich zur Firmen-Whitelist eigene Domains eintragen.\n\nDeaktiviert: Es gilt nur die Firmen-Whitelist. Benutzer können andere Webseiten nach Bestätigung der Warnung weiterhin öffnen, sie aber nicht dauerhaft erlauben.",
    },
  },
  {
    name: "enablePreemptiveChecks",
    type: "boolean",
    en: {
      title: "Force the confirmation page for non-whitelisted domains",
      explain:
        "Enabled: the confirmation page is always shown before a non-whitelisted domain loads, and users cannot turn it off.\n\nDisabled: the confirmation page is never shown; only the warning bar appears.\n\nNot configured: users decide.",
    },
    de: {
      title: "Bestätigungsseite für nicht erlaubte Domains erzwingen",
      explain:
        "Aktiviert: Vor dem Laden einer nicht erlaubten Domain erscheint immer die Bestätigungsseite; Benutzer können das nicht abschalten.\n\nDeaktiviert: Die Bestätigungsseite erscheint nie, nur die Warnleiste.\n\nNicht konfiguriert: Benutzer entscheiden selbst.",
    },
  },
  {
    name: "enableCountryBlock",
    type: "boolean",
    en: {
      title: "Force country checks",
      explain:
        "Enabled: the country of non-whitelisted domains is always looked up. Note that this sends the domain name to ip-api.com over an unencrypted connection.\n\nDisabled: no country lookups, no requests to ip-api.com.\n\nNot configured: users decide.",
    },
    de: {
      title: "Länderprüfung erzwingen",
      explain:
        "Aktiviert: Für nicht erlaubte Domains wird immer das Herkunftsland abgefragt. Achtung: Dabei wird der Domainname unverschlüsselt an ip-api.com gesendet.\n\nDeaktiviert: Keine Länderabfrage, keine Anfragen an ip-api.com.\n\nNicht konfiguriert: Benutzer entscheiden selbst.",
    },
  },
  {
    name: "blockedCountries",
    type: "list",
    en: {
      title: "Blocked countries",
      listLabel: "Country codes",
      explain:
        "Countries that are always blocked, as two-letter ISO 3166-1 codes, one per line (for example RU or KP). Only effective while country checks are on.",
    },
    de: {
      title: "Blockierte Länder",
      listLabel: "Ländercodes",
      explain:
        "Länder, die immer blockiert sind, als zweistellige ISO-3166-1-Codes, einer pro Zeile (zum Beispiel RU oder KP). Wirkt nur, solange die Länderprüfung eingeschaltet ist.",
    },
  },
];

const TEXT = {
  en: {
    displayName: "Domain Whitelist Protector",
    description: "Policy settings for the Domain Whitelist Protector extension",
    supported: "Domain Whitelist Protector 3.0 or later",
  },
  de: {
    displayName: "Domain Whitelist Protector",
    description: "Richtlinien für die Erweiterung Domain Whitelist Protector",
    supported: "Domain Whitelist Protector 3.0 oder neuer",
  },
};

function xml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pascal(name) {
  return name[0].toUpperCase() + name.slice(1);
}

// Chromium derives the extension ID from the public key of the packing key.
function extensionIdFromKey(pemPath) {
  if (!fs.existsSync(pemPath)) {
    // First run: create the packing key. It defines the extension ID.
    const { privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    fs.writeFileSync(
      pemPath,
      privateKey.export({ type: "pkcs8", format: "pem" }),
      { mode: 0o600 },
    );
    console.log(`Created new packing key: ${pemPath}`);
    console.log("Keep this file safe and private. Without it you cannot publish updates.");
  }
  const privateKey = crypto.createPrivateKey(fs.readFileSync(pemPath));
  const publicDer = crypto
    .createPublicKey(privateKey)
    .export({ type: "spki", format: "der" });
  const hash = crypto.createHash("sha256").update(publicDer).digest("hex");
  return [...hash.slice(0, 32)]
    .map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
    .join("");
}

function buildAdmx(extensionId) {
  const policies = [];
  for (const browser of BROWSERS) {
    const policyKey = `${browser.policyRoot}\\3rdparty\\extensions\\${extensionId}\\policy`;
    for (const policy of POLICIES) {
      const id = pascal(policy.name);
      const common = `name="${browser.prefix}_${id}" class="Machine" displayName="$(string.${id})" explainText="$(string.${id}_Explain)"`;
      const parents = `      <parentCategory ref="Cat_${browser.prefix}" />\n      <supportedOn ref="SUPPORTED_Extension" />`;
      if (policy.type === "list") {
        policies.push(
          `    <policy ${common} presentation="$(presentation.${id})" key="${policyKey}\\${policy.name}">\n${parents}\n      <elements>\n        <list id="${id}_List" valuePrefix="" />\n      </elements>\n    </policy>`,
        );
      } else {
        policies.push(
          `    <policy ${common} key="${policyKey}" valueName="${policy.name}">\n${parents}\n      <enabledValue>\n        <decimal value="1" />\n      </enabledValue>\n      <disabledValue>\n        <decimal value="0" />\n      </disabledValue>\n    </policy>`,
        );
      }
    }
  }

  const categories = BROWSERS.map(
    (browser) =>
      `    <category name="Cat_${browser.prefix}" displayName="$(string.Cat_${browser.prefix})">\n      <parentCategory ref="Cat_Root" />\n    </category>`,
  );

  return `<?xml version="1.0" encoding="utf-8"?>
<policyDefinitions xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" revision="1.0" schemaVersion="1.0" xmlns="http://schemas.microsoft.com/GroupPolicy/2006/07/PolicyDefinitions">
  <policyNamespaces>
    <target prefix="dwp" namespace="DomainWhitelistProtector.Policies" />
  </policyNamespaces>
  <resources minRequiredRevision="1.0" />
  <supportedOn>
    <definitions>
      <definition name="SUPPORTED_Extension" displayName="$(string.SUPPORTED_Extension)" />
    </definitions>
  </supportedOn>
  <categories>
    <category name="Cat_Root" displayName="$(string.Cat_Root)" />
${categories.join("\n")}
  </categories>
  <policies>
${policies.join("\n")}
  </policies>
</policyDefinitions>
`;
}

function buildAdml(language) {
  const text = TEXT[language];
  const strings = [
    ["SUPPORTED_Extension", text.supported],
    ["Cat_Root", text.displayName],
    ...BROWSERS.map((browser) => [`Cat_${browser.prefix}`, browser.label]),
  ];
  const presentations = [];
  for (const policy of POLICIES) {
    const id = pascal(policy.name);
    strings.push([id, policy[language].title]);
    strings.push([`${id}_Explain`, policy[language].explain]);
    if (policy.type === "list") {
      presentations.push(
        `      <presentation id="${id}">\n        <listBox refId="${id}_List">${xml(policy[language].listLabel)}</listBox>\n      </presentation>`,
      );
    }
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<policyDefinitionResources xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" revision="1.0" schemaVersion="1.0" xmlns="http://schemas.microsoft.com/GroupPolicy/2006/07/PolicyDefinitions">
  <displayName>${xml(text.displayName)}</displayName>
  <description>${xml(text.description)}</description>
  <resources>
    <stringTable>
${strings.map(([id, value]) => `      <string id="${id}">${xml(value)}</string>`).join("\n")}
    </stringTable>
    <presentationTable>
${presentations.join("\n")}
    </presentationTable>
  </resources>
</policyDefinitionResources>
`;
}

function buildUpdateXml(extensionId, crxUrl, version) {
  return `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${extensionId}'>
    <updatecheck codebase='${xml(crxUrl)}' version='${version}' />
  </app>
</gupdate>
`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--") || argv[i + 1] === undefined) {
      return null;
    }
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  console.error(
    "Usage: node scripts/enterprise.js --url <https://server/path> (--key <key.pem> | --id <extension id>)",
  );
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args || !args.url || (!args.key && !args.id)) {
    fail("--url and one of --key or --id are required.");
  }
  if (!/^https?:\/\//i.test(args.url)) {
    fail("--url must start with https:// or http://");
  }

  const extensionId = args.key ? extensionIdFromKey(args.key) : args.id;
  if (!/^[a-p]{32}$/.test(extensionId)) {
    fail("The extension ID must consist of 32 letters from a to p.");
  }

  const baseUrl = args.url.replace(/\/+$/, "");
  const updateUrl = `${baseUrl}/update.xml`;
  const crxUrl = `${baseUrl}/${PACKAGE_NAME}.crx`;

  validateSource();
  buildDirectories();

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  const extensionDir = path.join(OUT_DIR, PACKAGE_NAME);
  fs.cpSync(CHROME_DIR, extensionDir, { recursive: true });

  // Browsers look for later updates at the URL stored in the manifest.
  const manifestPath = path.join(extensionDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.update_url = updateUrl;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  fs.writeFileSync(
    path.join(OUT_DIR, "update.xml"),
    buildUpdateXml(extensionId, crxUrl, manifest.version),
  );

  const policyDir = path.join(OUT_DIR, "PolicyDefinitions");
  fs.mkdirSync(path.join(policyDir, "en-US"), { recursive: true });
  fs.mkdirSync(path.join(policyDir, "de-DE"), { recursive: true });
  fs.writeFileSync(path.join(policyDir, `${ADMX_NAME}.admx`), buildAdmx(extensionId));
  fs.writeFileSync(path.join(policyDir, "en-US", `${ADMX_NAME}.adml`), buildAdml("en"));
  fs.writeFileSync(path.join(policyDir, "de-DE", `${ADMX_NAME}.adml`), buildAdml("de"));

  const values = [
    "Domain Whitelist Protector - values for the Group Policy",
    "",
    `Extension ID:        ${extensionId}`,
    `Extension version:   ${manifest.version}`,
    `Update URL:          ${updateUrl}`,
    `Package URL:         ${crxUrl}`,
    "",
    "Value for the force-install list (Chrome and Edge):",
    `  ${extensionId};${updateUrl}`,
    "",
    "Registry paths the policy templates write to:",
    ...BROWSERS.map(
      (browser) =>
        `  HKLM\\${browser.policyRoot}\\3rdparty\\extensions\\${extensionId}\\policy`,
    ),
    "",
  ].join("\r\n");
  fs.writeFileSync(path.join(OUT_DIR, "gpo-values.txt"), values);

  console.log("");
  console.log(`Extension ID: ${extensionId}`);
  console.log(`Force-install value: ${extensionId};${updateUrl}`);
  console.log("");
  console.log("Created in dist/enterprise:");
  console.log(`  ${PACKAGE_NAME}/      extension folder to pack as ${PACKAGE_NAME}.crx`);
  console.log("  update.xml                       for the web server");
  console.log("  PolicyDefinitions/               Group Policy templates");
  console.log("  gpo-values.txt                   values to enter in the GPO");
}

main();
