const { execSync } = require('child_process');
const fs = require('fs');
const glob = require('glob');

const inputVersion = process.argv[2];
if (!inputVersion) {
    console.error("❌ Error: Provide a version.");
    process.exit(1);
}

const suitePrefix = "22.4";
const fullAppVersion = `"${suitePrefix}.${inputVersion}"`;

// --- NEW SMART GIT DETECTION ---
let baseRef = "";
try {
    // 1. Try to find the last tag (e.g., v4.1.49)
    baseRef = execSync('git describe --tags --abbrev=0').toString().trim();
    console.log(`ℹ️ Last release tag found: ${baseRef}. Comparing all changes since then.`);
} catch (e) {
    // 2. Fallback if no tags exist yet (e.g., first release)
    baseRef = "HEAD^";
    console.log(`ℹ️ No tags found. Comparing against previous commit only.`);
}

let diffFiles = "";
let diffStrict = ""; 
let diffContext = ""; 
try {
    // 3. Compare the BASE (last tag) to the current HEAD
    diffFiles = execSync(`git diff --name-only ${baseRef} HEAD`).toString();
    diffStrict = execSync(`git diff -U0 ${baseRef} HEAD`).toString();
    diffContext = execSync(`git diff -U20 ${baseRef} HEAD`).toString(); 
} catch (e) {
    console.error("❌ Error fetching git diff.");
    process.exit(1);
}
// --- END GIT DETECTION ---

const charts = glob.sync("Immutable/**/Chart.yaml");

charts.forEach(chartPath => {
    const chartContents = fs.readFileSync(chartPath, 'utf8');
    const chartDir = chartPath.replace('/Chart.yaml', '');
    const nameMatch = chartContents.match(/^name:\s*(.+)/m);
    const chartName = nameMatch ? nameMatch[1].trim() : "";
    const isParent = chartContents.includes('type: application');

    const isGlobalChanged = diffFiles.includes('global-values.yaml');
    const hasTemplateChanges = diffFiles.includes(`${chartDir}/templates/`);
    
    // Checks if the service block changed at any point in the multiple commits
    const serviceHunkRegex = new RegExp(`@@(.|\\n)*?${chartName}:(.|\\n)*?\\+`, 'g');
    const hasValuesChanges = serviceHunkRegex.test(diffContext);

    const metadataKeywords = /^\+.*(image:|configmap:|secret:|tag:|repository:)/im;
    const hasMetadataChanges = metadataKeywords.test(diffStrict) && hasValuesChanges;

    let updatedContents = chartContents;

    if (isParent) {
        const parentPrefix = chartName.toLowerCase().split('-')[1]; 
        const isMyDomainChanged = diffFiles.includes(`${parentPrefix}-values.yaml`);

        if (isMyDomainChanged || isGlobalChanged || hasTemplateChanges) {
            console.log(`>>> [PARENT] Bumping ${chartName}`);
            updatedContents = updatedContents.replace(/^version:.*$/m, `version: ${inputVersion}`);
            updatedContents = updatedContents.replace(/^appVersion:.*$/m, `appVersion: ${fullAppVersion}`);
            updatedContents = updatedContents.replace(/(- name:.*\n\s+version:)\s*[\d.]+/g, `$1 ${inputVersion}`);
        }
    } else {
        if (hasMetadataChanges && !hasTemplateChanges && !isGlobalChanged) {
            console.log(`>>> [CHILD] Metadata Update: ${chartName}`);
            updatedContents = updatedContents.replace(/^appVersion:.*$/m, `appVersion: ${fullAppVersion}`);
        } 
        else if (hasTemplateChanges || hasValuesChanges || isGlobalChanged) {
            console.log(`>>> [CHILD] Full Update: ${chartName}`);
            updatedContents = updatedContents.replace(/^version:.*$/m, `version: ${inputVersion}`);
            updatedContents = updatedContents.replace(/^appVersion:.*$/m, `appVersion: ${fullAppVersion}`);
        }
    }

    if (updatedContents !== chartContents) {
        fs.writeFileSync(chartPath, updatedContents);
    }
});

console.log(`✅ Finished processing version: ${inputVersion}`);