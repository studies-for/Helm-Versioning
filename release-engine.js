const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const glob = require('glob');

/**
 * CONFIGURATION & INPUT
 */
const inputVersion = process.argv[2];
if (!inputVersion) {
    console.error("❌ Error: Please provide a version number (e.g., node release-engine.js 5.2.0)");
    process.exit(1);
}

// All versions now exactly match the input
const targetVersion = inputVersion;

/**
 * 1. GIT ANALYSIS
 * Finds the total delta since the last successful release tag
 */
let baseRef = "";
try {
    baseRef = execSync('git describe --tags --abbrev=0').toString().trim();
    console.log(`ℹ️  Baseline: Comparing changes since ${baseRef}`);
} catch (e) {
    baseRef = "HEAD^";
    console.log(`ℹ️  Baseline: No tags found. Comparing against previous commit.`);
}

let diffFiles = "";
let diffContext = "";
try {
    diffFiles = execSync(`git diff --name-only ${baseRef} HEAD`).toString();
    // Fetch 50 lines of context to accurately find top-level YAML headers
    diffContext = execSync(`git diff -U50 ${baseRef} HEAD`).toString();
} catch (e) {
    console.error("❌ Error: Could not fetch git diff. Ensure you are in a Git repo.");
    process.exit(1);
}

/**
 * 2. SMART CHANGE DETECTION
 * Identifies if a specific service block has changes in the diff
 */
function getChangeStatus(diffText, chartName) {
    const lines = diffText.split('\n');
    let currentBlock = null;
    let hasActualChanges = false;
    let isMetadataOnly = false;

    for (let line of lines) {
        // Matches top-level YAML keys (zero indentation) in the diff
        // e.g., "idc-1:", "child-2:"
        const headerMatch = line.match(/^[ +-]([^\s][\w-]+):/);
        if (headerMatch) {
            currentBlock = headerMatch[1];
        }

        // Only look at added lines (+)
        if (line.startsWith('+') && !line.startsWith('+++')) {
            if (currentBlock === chartName) {
                hasActualChanges = true;
                // Check if the change is limited to metadata (image, config, secret, tags)
                const metadataKeywords = /image:|configmap:|secret:|tag:|repository:/i;
                isMetadataOnly = metadataKeywords.test(line);
            }
        }
    }
    return { hasActualChanges, isMetadataOnly };
}

/**
 * 3. DYNAMIC CHART PROCESSING
 */
const allCharts = glob.sync("Immutable/**/Chart.yaml");

allCharts.forEach(chartPath => {
    const originalContents = fs.readFileSync(chartPath, 'utf8');
    const chartDir = path.dirname(chartPath);
    const chartName = (originalContents.match(/^name:\s*(.+)/m) || [])[1]?.trim();
    const isParent = originalContents.includes('type: application');

    // Identify Domain (The folder name inside Immutable, e.g., "IDC" or "ARX")
    const pathParts = chartPath.split(path.sep);
    const domainIndex = pathParts.indexOf('Immutable') + 1;
    const domainName = pathParts[domainIndex].toLowerCase();

    // Check conditions
    const globalChanged = diffFiles.includes('global-values.yaml');
    const domainValuesChanged = diffFiles.includes(`${domainName}-values.yaml`);
    const templatesChanged = diffFiles.includes(path.join(chartDir, 'templates'));
    const changeStatus = getChangeStatus(diffContext, chartName);

    let newContents = originalContents;
    let updateNeeded = false;

    if (isParent) {
        // PARENT RULE: Bump if Global changed, its Domain changed, or its own Templates changed
        if (globalChanged || domainValuesChanged || templatesChanged) {
            updateNeeded = true;
            console.log(`🚀 [PARENT] ${chartName} -> ${targetVersion}`);
            newContents = newContents.replace(/^version:.*$/m, `version: ${targetVersion}`);
            newContents = newContents.replace(/^appVersion:.*$/m, `appVersion: "${targetVersion}"`);

            // Sync Dependencies: Only update children that actually changed in this release
            const depLines = newContents.match(/- name:\s*(.+)/g);
            if (depLines) {
                depLines.forEach(line => {
                    const depName = line.split(':')[1].trim();
                    const depStatus = getChangeStatus(diffContext, depName);
                    const depFolderChanged = diffFiles.includes(`${depName}/`);
                    
                    if (depStatus.hasActualChanges || depFolderChanged || globalChanged) {
                        console.log(`   └─ Syncing Dependency: ${depName}`);
                        const reg = new RegExp(`(- name: ${depName}\\r?\\n\\s+version:)\\s*[\\d.]+`, 'g');
                        newContents = newContents.replace(reg, `$1 ${targetVersion}`);
                    }
                });
            }
        }
    } else {
        // CHILD RULE
        if (changeStatus.hasActualChanges || templatesChanged || globalChanged) {
            updateNeeded = true;
            
            // If it's ONLY metadata (image/config/secret) and no templates changed
            if (changeStatus.isMetadataOnly && !templatesChanged && !globalChanged) {
                console.log(`📝 [CHILD] ${chartName} (Metadata Only) -> appVersion: ${targetVersion}`);
                newContents = newContents.replace(/^appVersion:.*$/m, `appVersion: "${targetVersion}"`);
            } else {
                console.log(`🔥 [CHILD] ${chartName} (Full Update) -> ${targetVersion}`);
                newContents = newContents.replace(/^version:.*$/m, `version: ${targetVersion}`);
                newContents = newContents.replace(/^appVersion:.*$/m, `appVersion: "${targetVersion}"`);
            }
        }
    }

    if (updateNeeded) {
        fs.writeFileSync(chartPath, newContents);
    }
});

console.log(`\n✅ Done! All charts processed for version ${targetVersion}`);