const { execSync } = require('child_process');

module.exports = {
  // 1. Read current version from YAML
  readVersion: function(contents) {
    const m = contents.match(/^version:\s*([\d.]+)/m);
    return m ? m[1] : '0.0.0';
  },

  // 2. Write new version based on your rules
  writeVersion: function(contents, version) {
    const suitePrefix = "22.4";
    const fullAppVersion = `${suitePrefix}.${version}`;

    // Detect the chart name from the YAML content
    const nameMatch = contents.match(/^name:\s*(.+)/m);
    const chartName = nameMatch ? nameMatch[1].trim() : "";

    // Identify if this is the Parent Chart
    const isParent = contents.includes('type: application');

    // Get Git Changes (Detect what changed in this commit)
    let changedFiles = "";
    try {
        // In GitHub Actions, we compare HEAD with the previous commit
        changedFiles = execSync('git diff --name-only HEAD~1').toString();
    } catch (e) {
        // Fallback for local testing or first commit
        changedFiles = execSync('git diff --name-only').toString();
    }

    const isGlobalChanged = changedFiles.includes('mutable/UAT/global-values.yaml');
    const isThisChartChanged = chartName && changedFiles.includes(chartName);

    let newContents = contents;

    // RULE: Update this chart ONLY if Global changed OR this specific chart changed OR it's the Parent
    if (isGlobalChanged || isThisChartChanged || isParent) {
        
        // Update Chart Version
        newContents = newContents.replace(/^version:.*$/m, `version: ${version}`);
        
        // Update AppVersion with Quotes
        newContents = newContents.replace(/^appVersion:.*$/m, `appVersion: "${fullAppVersion}"`);

        // RULE: If it's the Parent, update the versions in the 'dependencies' section
        if (isParent) {
            // This updates all dependency versions to match the new release version
            newContents = newContents.replace(/(- name:.*\n\s+version:)\s*[\d.]+/g, `$1 ${version}`);
        }
    }

    return newContents;
  }
};
