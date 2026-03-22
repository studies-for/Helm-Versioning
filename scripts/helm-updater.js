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

    // 1. Get current Chart info
    const nameMatch = contents.match(/^name:\s*(.+)/m);
    const chartName = nameMatch ? nameMatch[1].trim() : "";
    const isParent = contents.includes('type: application');
    
    // Determine Domain (ARX or IDC) based on file path
    // this.filename is provided by standard-version in newer versions, 
    // but we can also detect it from the logic below.

    // 2. Get the Git Diff (Lines added/removed)
    let diff = "";
    try {
        diff = execSync('git diff -U0 HEAD~1').toString();
    } catch (e) {
        diff = execSync('git diff -U0').toString();
    }

    // 3. IDENTIFICATION LOGIC
    const isGlobalChanged = diff.includes('mutable/global-values.yaml');
    
    // Check if the specific values file for this chart's group changed
    // If chart is 'child-1', we look for 'arx-values.yaml'
    // If chart is 'idc-1', we look for 'idc-values.yaml'
    const isArxValuesChanged = diff.includes('mutable/arx-values.yaml');
    const isIdcValuesChanged = diff.includes('mutable/idc-values.yaml');

    // Check if THIS specific service block was modified inside those files
    const isServiceBlockChanged = diff.includes(`${chartName}:`);
    
    // Check if the actual source code/templates changed
    const isDirectoryChanged = diff.includes(`/${chartName}/`);

    let newContents = contents;
    let shouldUpdate = false;

    // RULE 1: Global change -> Update EVERYTHING
    if (isGlobalChanged) shouldUpdate = true;

    // RULE 2: Specific Child Update Logic
    if (!isParent) {
        if (isDirectoryChanged || isServiceBlockChanged) {
            shouldUpdate = true;
        }
    }

    // RULE 3: Parent Update Logic
    if (isParent) {
        // Parent updates if its own folder changed OR its respective domain values file changed
        const isArxParent = chartName.toLowerCase().includes('arx');
        const isIdcParent = chartName.toLowerCase().includes('idc');
        
        if ((isArxParent && isArxValuesChanged) || (isIdcParent && isIdcValuesChanged) || isDirectoryChanged || isGlobalChanged) {
            shouldUpdate = true;
        }
    }

    // 4. PERFORM THE UPDATE
    if (shouldUpdate) {
        console.log(`>>> Bumping ${chartName} to ${version}`);
        
        // Update Chart Version
        newContents = newContents.replace(/^version:.*$/m, `version: ${version}`);
        
        // Update AppVersion
        newContents = newContents.replace(/^appVersion:.*$/m, `appVersion: "${fullAppVersion}"`);

        // 5. SYNC DEPENDENCIES (If Parent)
        if (isParent) {
            // We scan the diff to see which specific children changed and update only those in the 'dependencies' list
            const dependencies = contents.match(/- name:\s*(.+)/g);
            if (dependencies) {
                dependencies.forEach(depLine => {
                    const depName = depLine.split(':')[1].trim();
                    const depChanged = diff.includes(`${depName}:`) || diff.includes(`/${depName}/`) || isGlobalChanged;
                    
                    if (depChanged) {
                        const regex = new RegExp(`(- name: ${depName}\\n\\s+version:)\\s*[\\d.]+`, 'g');
                        newContents = newContents.replace(regex, `$1 ${version}`);
                    }
                });
            }
        }
    }

    return newContents;
  }
};
