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
    const filePath = this.filename; // standard-version provides the current file path

    // 1. Get changed files in this commit
    const changedFiles = execSync('git diff --name-only HEAD').toString();
    
    // 2. Logic: Global Change Check
    const globalChanged = changedFiles.includes('mutable/DIT/global-values.yaml');

    // 3. Logic: Check if THIS specific chart folder changed
    const chartDir = path.dirname(filePath);
    const chartChanged = changedFiles.includes(chartDir);

    let newContents = contents;

    // RULE: If Global changed OR this specific chart changed, update appVersion
    if (globalChanged || chartChanged) {
        
        // If Template changed -> Bump version
        // (Checks if any .yaml file in the specific chart's template folder changed)
        if (changedFiles.includes(`${chartDir}/templates`) || globalChanged) {
             newContents = newContents.replace(/^version:.*$/m, `version: ${version}`);
        }

        // If Values, Image, or Global changed -> Bump appVersion
        if (changedFiles.includes(`${chartDir}/values.yaml`) || globalChanged) {
             newContents = newContents.replace(/^appVersion:.*$/m, `appVersion: "${fullAppVersion}"`);
        }
    }

    return newContents;
  }
};