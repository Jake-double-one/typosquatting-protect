async function exportData() {
  // Only the user's own entries; the organization list lives in the policy
  const whitelist = await getUserWhitelist();
  const resultCountryBlock = await browserAPI.storage.sync.get([
    "blockedCountries",
  ]);
  const countryBlock = resultCountryBlock.blockedCountries || [];
  const dataStr = JSON.stringify({ whitelist, countryBlock }, null, 2);
  const dataUri =
    "data:application/json;charset=utf-8," + encodeURIComponent(dataStr);

  const exportLink = document.createElement("a");
  exportLink.setAttribute("href", dataUri);
  exportLink.setAttribute(
    "download",
    "whitelist_domains_" + new Date().toISOString().split("T")[0] + ".json",
  );
  exportLink.click();
}

function importData(event) {
  const file = event.target.files[0];

  if (!file) {
    return;
  }

  const reader = new FileReader();

  reader.onload = async function (e) {
    try {
      const importedData = JSON.parse(e.target.result);

      if (
        !importedData ||
        typeof importedData !== "object" ||
        !Array.isArray(importedData.whitelist) ||
        !Array.isArray(importedData.countryBlock)
      ) {
        alert(
          "Invalid format. The imported file must contain a JSON object with 'whitelist' and 'countryBlock' arrays.",
        );
        return;
      }

      const result = await browserAPI.storage.sync.get(["blockedCountries"]);

      let whitelist = await getUserWhitelist();
      let countryBlock = result.blockedCountries || [];

      // Add unique domains from imported whitelist
      whitelist = normalizeList([...whitelist, ...importedData.whitelist]);

      // Add unique countries from imported countryBlock
      importedData.countryBlock.forEach(function (country) {
        if (typeof country === "string" && !countryBlock.includes(country)) {
          countryBlock.push(country);
        }
      });

      await setUserWhitelist(whitelist);
      await browserAPI.storage.sync.set({ blockedCountries: countryBlock });

      loadWhitelist();
      loadBlockedCountries();

      alert(
        `Successfully imported ${importedData.whitelist.length} domains and ${importedData.countryBlock.length} blocked countries.`,
      );
    } catch (error) {
      alert("Error parsing the imported file: " + error.message);
    }
  };

  reader.readAsText(file);
  // Reset the file input so the same file can be imported again if needed
  event.target.value = null;
}
