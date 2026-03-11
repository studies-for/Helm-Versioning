module.exports = {
  // 1. Extract the version from the file
  readVersion: function(contents) {
    const versionMatch = contents.match(/^version:\s*(['"]?)([\d.]+)\1/m);
    if (versionMatch) {
      return versionMatch[2];
    }
    return undefined;
  },

  // 2. Write the new version and appVersion back to the file
  writeVersion: function(contents, version) {
    const suitePrefix = "22.4";
    
    // Replace the version: line
    let newContents = contents.replace(
      /^version:\s*(['"]?)([\d.]+)\1/m, 
      `version: ${version}`
    );

    // Replace the appVersion: line with your suite prefix
    newContents = newContents.replace(
      /^appVersion:\s*(['"]?)([\d.]+)\1/m, 
      `appVersion: "${suitePrefix}.${version}"`
    );

    return newContents;
  }
};