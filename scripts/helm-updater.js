const { execSync } = require('child_process');
const path = require('path');

module.exports = {
  readVersion: function(contents) {
    const m = contents.match(/^version:\s*([\d.]+)/m);
    return m ? m[1] : '0.0.0';
  },

  writeVersion: function(contents, version) {
    const suitePrefix = "22.4";
    const fullAppVersion = `${suitePrefix}.${version}`;
    const filePath = this.filename; // Provided by standard-version
    const chartDir = path.dirname(filePath);

    // 1. Get list of files changed in this specific commit/MR
    const changedFiles = execSync('git diff --name-only HEAD^ HEAD').toString();

    // 2. Identify the specific changes
    const globalChanged = changedFiles.includes('mutable/DIT/global-values.yaml');
    const chartChanged = changedFiles.includes(chartDir);
    const templateChanged = changedFiles.includes(`${chartDir}/templates/`);
    const valuesChanged = changedFiles.includes(`${chartDir}/values.yaml`);

    let newContents = contents;

    // RULE: If Global values change -> Update appVersion for ALL charts
    if (globalChanged) {
        newContents = newContents.replace(/^appVersion:.*$/m, `appVersion: "${fullAppVersion}"`);
        // Note: You can also choose to bump the chart version here if desired
    }

    // RULE: If this specific chart has Template, Values, or Image changes
    if (chartChanged) {
        if (templateChanged || valuesChanged) {
            // Apply synchronized update to both fields
            newContents = newContents.replace(/^version:.*$/m, `version: ${version}`);
            newContents = newContents.replace(/^appVersion:.*$/m, `appVersion: "${fullAppVersion}"`);
            console.log(`>>> Updated ${filePath}: version and appVersion set to ${version}`);
        }
    }

    return newContents;
  }
};
