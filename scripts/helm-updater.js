const { execSync } = require('child_process');

module.exports = {
  readVersion: function(contents) {
    const m = contents.match(/^version:\s*([\d.]+)/m);
    return m ? m[1] : '0.0.0';
  },

  writeVersion: function(contents, version) {
    const suitePrefix = "22";
    const fullAppVersion = `${suitePrefix}.${version}`;

    // 1. Get Chart Name and Type
    const nameMatch = contents.match(/^name:\s*(.+)/m);
    const chartName = nameMatch ? nameMatch[1].trim() : "";
    const isParent = contents.includes('type: application');

    // 2. Get Git Diff (Lines changed in this commit)
    let diff = "";
    try {
        // HEAD~1 looks at the changes in the most recent commit
        diff = execSync('git diff -U0 HEAD~1').toString();
    } catch (e) {
        diff = execSync('git diff -U0').toString();
    }

    // 3. Common Change Detection
    const isGlobalChanged = diff.includes('global-values.yaml');
    const isDirectoryChanged = diff.includes(`/${chartName}/`);
    const isValuesBlockChanged = diff.includes(`${chartName}:`);

    let shouldUpdate = false;
    let newContents = contents;

    // RULE 1: Global change -> Update everything
    if (isGlobalChanged) shouldUpdate = true;

    // RULE 2: Child Update Logic
    if (!isParent && (isDirectoryChanged || isValuesBlockChanged)) {
        shouldUpdate = true;
    }

    // RULE 3: Parent Update Logic (The "Dependency Check")
    if (isParent) {
        // A Parent must update if:
        // a) Its own directory changed
        // b) ANY of its dependencies appear in the diff (either as a folder or a values block)
        const depLines = contents.match(/- name:\s*(.+)/g);
        if (depLines) {
            for (const line of depLines) {
                const depName = line.split(':')[1].trim();
                if (diff.includes(`${depName}:`) || diff.includes(`/${depName}/`)) {
                    shouldUpdate = true;
                    break;
                }
            }
        }
        if (isDirectoryChanged) shouldUpdate = true;
    }

    // 4. PERFORM UPDATE
    if (shouldUpdate) {
        console.log(`>>> Bumping ${chartName} to ${version}`);
        
        // Update Chart Version
        newContents = newContents.replace(/^version:.*$/m, `version: ${version}`);
        
        // Update AppVersion
        newContents = newContents.replace(/^appVersion:.*$/m, `appVersion: "${fullAppVersion}"`);

        // 5. UPDATE DEPENDENCY LIST (If Parent)
        if (isParent) {
            const depLines = contents.match(/- name:\s*(.+)/g);
            if (depLines) {
                depLines.forEach(line => {
                    const depName = line.split(':')[1].trim();
                    // Update the specific dependency version only if that child changed or Global changed
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
