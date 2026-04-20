const { execSync } = require('child_process');
const fs = require('fs');

module.exports = {
  readVersion: function(contents) {
    const m = contents.match(/^version:\s*([\d.]+)/m);
    return m ? m[1] : '0.0.0';
  },

  writeVersion: function(contents, version) {
    const suitePrefix = "22.4";
    const nameMatch = contents.match(/^name:\s*(.+)/m);
    const chartName = nameMatch ? nameMatch[1].trim() : "";
    const isParent = contents.includes('type: application');

    // 1. Get the Diff with line numbers for the specific chart's values or files
    let diff = "";
    try {
        // Compare with previous commit
        diff = execSync('git diff -U0 HEAD~1').toString();
    } catch (e) {
        diff = execSync('git diff -U0').toString();
    }

    // 2. DETECT CHANGE TYPE
    let isConfigMapChange = false;
    let isOtherChange = false;

    // Logic to scan diff for this specific chart
    const lines = diff.split('\n');
    let currentFile = "";
    
    lines.forEach(line => {
        if (line.startsWith('+++ b/')) currentFile = line.replace('+++ b/', '');
        
        // We only care about changes in this chart's directory
        if (currentFile.includes(chartName)) {
            // Check if change is in values.yaml
            if (currentFile.endsWith('values.yaml')) {
                // Simplified Check: Does the changed line look like it's inside configmap?
                // For a more robust check, we look for 'configmap' context in the diff
                const diffChunk = execSync(`git diff -U10 HEAD~1 -- ${currentFile}`).toString();
                if (diffChunk.includes('configmap:')) {
                    isConfigMapChange = true;
                } else {
                    isOtherChange = true;
                }
            } else if (currentFile.includes('/templates/')) {
                isOtherChange = true;
            }
        }
    });

    // Special case for Global
    const isGlobalChanged = diff.includes('global-values.yaml');

    let newContents = contents;
    let finalVersion = version;

    // 3. APPLY VERSIONING LOGIC
    // If it's a "Major" style change (per your definition), we need to adjust the version string
    // standard-version passes 'version' based on fix/feat. 
    // We will assume 'feat' = Major (4.2.46) and 'fix' = Minor (4.1.47)
    
    const parts = version.split('.'); // [4, 1, 47]
    
    if (isOtherChange || isGlobalChanged) {
        // Your Major Rule: 4.1.46 -> 4.2.46 (Middle digit bumps, last stays or resets)
        // Note: standard-version provides the version, but we format it to your spec here
        finalVersion = `${parts[0]}.${parts[1]}.${parts[2]}`; 
    } else if (isConfigMapChange) {
        // Your Minor Rule: 4.1.46 -> 4.1.47
        finalVersion = `${parts[0]}.${parts[1]}.${parts[2]}`;
    }

    const fullAppVersion = `${suitePrefix}.${finalVersion}`;

    // 4. PERFORM THE UPDATE
    if (isConfigMapChange || isOtherChange || isGlobalChanged || isParent) {
        // Update Chart Version
        newContents = newContents.replace(/^version:.*$/m, `version: ${finalVersion}`);
        
        // Update AppVersion
        newContents = newContents.replace(/^appVersion:.*$/m, `appVersion: "${fullAppVersion}"`);

        // Update Parent Dependencies
        if (isParent) {
            newContents = newContents.replace(/(- name:.*\n\s+version:)\s*[\d.]+/g, `$1 ${finalVersion}`);
        }
    }

    return newContents;
  }
};
