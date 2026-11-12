const test = require("node:test");
const assert = require("node:assert/strict");
const { loadExtension } = require("./load");

const ext = loadExtension();

test("normalizeEntry turns input into a canonical entry", () => {
  assert.equal(ext.normalizeEntry("Example.COM"), "example.com");
  assert.equal(ext.normalizeEntry("https://Firma.SharePoint.com/sites/x?y=1"), "firma.sharepoint.com");
  assert.equal(ext.normalizeEntry("*.Example.com"), "*.example.com");
  assert.equal(ext.normalizeEntry("example.com."), "example.com");
  assert.equal(ext.normalizeEntry("example.com:8443/path"), "example.com");
  assert.equal(ext.normalizeEntry("müller.de"), "xn--mller-kva.de");
});

test("normalizeEntry rejects invalid input", () => {
  for (const input of ["", "   ", "*.", "a*b.com", "user@example.com", 42, null]) {
    assert.equal(ext.normalizeEntry(input), null, String(input));
  }
});

test("isWhitelisted matches exact entries and wildcards", () => {
  const list = ["example.com", "*.sharepoint.com"];
  assert.ok(ext.isWhitelisted("example.com", list));
  assert.ok(ext.isWhitelisted("EXAMPLE.com.", list));
  assert.ok(ext.isWhitelisted("firma.sharepoint.com", list));
  assert.ok(ext.isWhitelisted("a.b.sharepoint.com", list));
  assert.ok(ext.isWhitelisted("sharepoint.com", list), "wildcard covers the domain itself");
  assert.ok(!ext.isWhitelisted("sub.example.com", list), "exact entry has no subdomains");
});

test("wildcards do not match lookalike domains", () => {
  const list = ["*.sharepoint.com"];
  assert.ok(!ext.isWhitelisted("evilsharepoint.com", list));
  assert.ok(!ext.isWhitelisted("sharepoint.com.evil.net", list));
  assert.ok(!ext.isWhitelisted("", list));
});

test("findRedundantEntries reports entries covered by others", () => {
  const user = ["a.example.com", "*.example.com", "example.com", "*.sub.example.com", "other.org", "x.sharepoint.com", "*.sharepoint.com"];
  assert.deepEqual(
    [...ext.findRedundantEntries(user, ["*.sharepoint.com"])],
    ["a.example.com", "example.com", "*.sub.example.com", "x.sharepoint.com", "*.sharepoint.com"],
  );
  assert.deepEqual([...ext.findRedundantEntries(["a.com", "b.com"], [])], []);
});

test("the user whitelist is split across storage items and read back", async () => {
  const sync = {};
  const store = loadExtension({ sync });
  const domains = Array.from({ length: 1500 }, (_, i) => `host-number-${i}.example-long-domain.org`);

  await store.setUserWhitelist(domains);
  const keys = Object.keys(sync).filter((key) => key.startsWith("whitelist"));
  assert.ok(keys.length > 1, "more than one storage item");
  for (const key of keys) {
    assert.ok(JSON.stringify(sync[key]).length < 8000, `${key} stays below the item limit`);
  }
  assert.equal((await store.getUserWhitelist()).length, 1500);

  await store.setUserWhitelist(["a.test"]);
  assert.deepEqual(Object.keys(sync).filter((key) => key.startsWith("whitelist")), ["whitelist"]);
  assert.deepEqual([...(await store.getUserWhitelist())], ["a.test"]);
});

test("addToUserWhitelist ignores duplicates and invalid entries", async () => {
  const store = loadExtension();
  assert.equal(await store.addToUserWhitelist("Example.com"), true);
  assert.equal(await store.addToUserWhitelist("example.com"), false);
  assert.equal(await store.addToUserWhitelist("not valid!*"), false);
  assert.deepEqual([...(await store.getUserWhitelist())], ["example.com"]);
});
