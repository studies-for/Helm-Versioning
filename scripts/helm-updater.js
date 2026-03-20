const { execSync } = require('child_process');
const path = require('path');

module.exports = {
  readVersion: function(contents) {
    const m = contents.match(/^version:\s*([\d.]+)/m);
    return m ? m[1] : '0.0.0';
  },

  writeVersion: function(contents, version) {
    const suitePrefix = "22.4";
    const filePath = this.filename; 
    const chartDir = path.dirname(filePath);

    // 1. Get the list of files changed in this specific commit
    const changedFiles = execSync('git diff --name-only HEAD^ HEAD').toString();

    // 2. Identify the types of changes
    const isGlobalChanged = changedFiles.includes('mutable/DIT/global-values.yaml');
    const isThisChartChanged = changedFiles.includes(chartDir);
    const isParent = contents.includes('type: application'); // Parent chart identification

    let newContents = contents;

    // RULE 1: If Global changed OR this specific child changed -> Update Version & AppVersion
    if (isGlobalChanged || isThisChartChanged) {
        console.log(`>>> Updating ${filePath} due to ${isGlobalChanged ? 'Global' : 'Local'} change.`);
        
        // Update Chart Version
        newContents = newContents.replace(/^version:.*$/m, `version: ${version}`);
        
        // Update AppVersion with Suite Prefix
        newContents = newContents.replace(/^appVersion:.*$/m, `appVersion: "${suitePrefix}.${version}"`);
    }

    // RULE 2: If we are in the PARENT Chart, we must also update the dependency versions
    if (isParent) {
        // This regex finds the versions inside the 'dependencies' block and updates them to match the new release
        newContents = newContents.replace(/(- name:.*\n\s+version:)\s*[\d.]+/g, `$1 ${version}`);
    }

    return newContents;
  }
};
