const { execSync } = require('child_process');

module.exports = {
  readVersion: function(contents) {
    const m = contents.match(/^version:\s*([\d.]+)/m);
    return m ? m[1] : '0.0.0';
  },

  writeVersion: function(contents, version) {
    const suitePrefix = "22.4";
    const fullAppVersion = `${suitePrefix}.${version}`;

    // 1. Detect this chart's name from its own Chart.yaml
    const nameMatch = contents.match(/^name:\s*(.+)/m);
    const chartName = nameMatch ? nameMatch[1].trim() : "";
    const isParent = contents.includes('type: application');

    // 2. Get the Git Diff of the actual lines changed
    // -U0 ensures we only see the lines added/removed without context
    let diff = "";
    try {
        diff = execSync('git diff -U0 HEAD~1').toString();
    } catch (e) {
        diff = execSync('git diff -U0').toString();
    }

    // 3. IDENTIFICATION LOGIC
    const globalFileChanged = diff.includes('mutable/UAT/global-values.yaml');
    
    // Check if the specific child section in values.yaml was modified
    // This looks for "+  child-1:" or any change under the "child-1:" block
    const childSectionChanged = diff.includes(`${chartName}:`);
    
    // Check if files inside the child's own directory changed
    const directoryChanged = diff.includes(`charts/${chartName}/`);

    let newContents = contents;

    // RULE: Update Child Chart
    if (!isParent) {
        if (globalFileChanged || childSectionChanged || directoryChanged) {
            console.log(`>>> Bumping Child: ${chartName}`);
            newContents = newContents.replace(/^version:.*$/m, `version: ${version}`);
            newContents = newContents.replace(/^appVersion:.*$/m, `appVersion: "${fullAppVersion}"`);
        }
    }

    // RULE: Update Parent Chart
    if (isParent) {
        console.log(`>>> Bumping Parent and checking dependencies...`);
        newContents = newContents.replace(/^version:.*$/m, `version: ${version}`);
        newContents = newContents.replace(/^appVersion:.*$/m, `appVersion: "${suitePrefix}.${version}"`);

        // ONLY update dependency version if that specific child actually changed
        // This prevents child-2 from being bumped in the parent if only child-1 changed
        const childNames = ["child-1", "child-2"]; // Add your other 50+ names or detect them
        childNames.forEach(name => {
            const thisChildChanged = diff.includes(`${name}:`) || diff.includes(`charts/${name}/`);
            if (thisChildChanged || globalFileChanged) {
                const regex = new RegExp(`(- name: ${name}\\n\\s+version:)\\s*[\\d.]+`, 'g');
                newContents = newContents.replace(regex, `$1 ${version}`);
            }
        });
    }

    return newContents;
  }
};
