const { execSync } = require('child_process');
const fs = require('fs');
const glob = require('glob');

// 1. Capture the input version from the command line
const inputVersion = process.argv[2];
if (!inputVersion) {
    console.error("❌ Error: Provide a version. Example: node release-engine.js 4.2.5");
    process.exit(1);
}

const suitePrefix = "22";
const fullAppVersion = `"${suitePrefix}.${inputVersion}"`;

// 2. Capture Git Changes (Diff between current state and previous commit)
let diffFiles = "";
let diffContent = "";
try {
    diffFiles = execSync('git diff --name-only HEAD^ HEAD').toString();
    diffContent = execSync('git diff -U0 HEAD^ HEAD').toString();
} catch (e) {
    diffFiles = execSync('git diff --name-only').toString();
    diffContent = execSync('git diff -U0').toString();
}

// 3. Find all Chart.yaml files in the Monorepo
const charts = glob.sync("Immutable/**/Chart.yaml");

charts.forEach(chartPath => {
    const chartContents = fs.readFileSync(chartPath, 'utf8');
    const chartDir = chartPath.replace('/Chart.yaml', '');
    const nameMatch = chartContents.match(/^name:\s*(.+)/m);
    const chartName = nameMatch ? nameMatch[1].trim() : "";
    const isParent = chartContents.includes('type: application');

    // 4. Logic: Detect Change Types
    const hasTemplateChanges = diffFiles.includes(`${chartDir}/templates/`);
    const hasValuesChanges = diffContent.includes(`${chartName}:`);
    const isGlobalChanged = diffFiles.includes('global-values.yaml');

    // Check for Metadata Keywords in the values diff (image, configmap, secret)
    // We check for lines starting with + to only look at what was added/changed
    const metadataKeywords = /\+.*(image:|configmap:|secret:)/i;
    const hasMetadataChanges = metadataKeywords.test(diffContent) && hasValuesChanges;

    let updatedContents = chartContents;

    if (isParent) {
        // RULE: Parent always updates both version and appVersion to match release input
        console.log(`>>> [PARENT] Bumping ${chartName}`);
        updatedContents = updatedContents.replace(/^version:.*$/m, `version: ${inputVersion}`);
        updatedContents = updatedContents.replace(/^appVersion:.*$/m, `appVersion: ${fullAppVersion}`);
        
        // Sync dependency versions inside parent
        updatedContents = updatedContents.replace(/(- name:.*\n\s+version:)\s*[\d.]+/g, `$1 ${inputVersion}`);
    } else {
        // RULE: Child Logic
        if (hasMetadataChanges && !hasTemplateChanges && !isGlobalChanged) {
            // ONLY appVersion changes
            console.log(`>>> [CHILD] Metadata Update (appVersion only): ${chartName}`);
            updatedContents = updatedContents.replace(/^appVersion:.*$/m, `appVersion: ${fullAppVersion}`);
        } 
        else if (hasTemplateChanges || hasValuesChanges || isGlobalChanged) {
            // BOTH version and appVersion change
            console.log(`>>> [CHILD] Full Update (Version + appVersion): ${chartName}`);
            updatedContents = updatedContents.replace(/^version:.*$/m, `version: ${inputVersion}`);
            updatedContents = updatedContents.replace(/^appVersion:.*$/m, `appVersion: ${fullAppVersion}`);
        }
    }

    // 5. Save the file if changes were made
    if (updatedContents !== chartContents) {
        fs.writeFileSync(chartPath, updatedContents);
    }
});

console.log(`✅ Release Processing Complete for version: ${inputVersion}`);