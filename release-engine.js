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

const targetVersion = inputVersion;

/**
 * 1. GIT ANALYSIS
 */
let baseRef = "";
try {
    baseRef = execSync('git describe --tags --abbrev=0').toString().trim();
    console.log(`ℹ️ Baseline: Comparing changes since tag ${baseRef}`);
} catch (e) {
    baseRef = "HEAD^";
    console.log(`ℹ️ Baseline: No tags found. Comparing against previous commit.`);
}

let diffFiles = "";
let diffContext = "";
try {
    diffFiles = execSync(`git diff --name-only ${baseRef} HEAD`).toString();
    // Use -U100 to ensure we capture the top-level headers for all changed lines
    diffContext = execSync(`git diff -U100 ${baseRef} HEAD`).toString();
} catch (e) {
    console.error("❌ Error: Could not fetch git diff.");
    process.exit(1);
}

/**
 * 2. BLOCK-ISOLATED CHANGE DETECTION
 * Isolates the YAML block for a specific service to prevent "leakage" between services.
 */
function getChangeStatus(diffText, chartName) {
    // This regex finds the block starting with "service-name:" and ends before the next top-level key
    // [ +-] handles the git diff prefix; [^\\s] ensures it's a top-level key (zero indent)
    const regex = new RegExp(`^[ +-]${chartName}:[\\s\\S]*?(?=\\n[ +-][^\\s]|$)`, 'gm');
    const match = diffText.match(regex);

    if (!match) return { hasActualChanges: false, isMetadataOnly: false };

    let hasActualChanges = false;
    let isMetadataOnly = true; // Assume metadata only until proven otherwise

    // Process the isolated block line by line
    const lines = match[0].split('\n');
    for (let line of lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
            hasActualChanges = true;
            const metadataKeywords = /image:|configmap:|secret:|tag:|repository:/i;
            if (!metadataKeywords.test(line)) {
                isMetadataOnly = false; // Found a change that isn't just metadata
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

    // Identify Domain (IDC or ARX) based on the folder path
    const pathParts = chartPath.split(/[\\/]/); // Handles both Windows and Linux paths
    const immutableIndex = pathParts.indexOf('Immutable');
    const domainName = pathParts[immutableIndex + 1].toLowerCase();

    // Environment Checks
    const globalChanged = diffFiles.includes('global-values.yaml');
    const domainValuesChanged = diffFiles.includes(`${domainName}-values.yaml`);
    const templatesChanged = diffFiles.includes(path.join(chartDir, 'templates').replace(/\\/g, '/'));
    const changeStatus = getChangeStatus(diffContext, chartName);

    let newContents = originalContents;
    let updateNeeded = false;

    if (isParent) {
        // PARENT RULE: Bump if Global changed, its specific Domain values file changed, or its own Templates changed
        if (globalChanged || domainValuesChanged || templatesChanged) {
            updateNeeded = true;
            console.log(`🚀 [PARENT] ${chartName} -> ${targetVersion}`);
            newContents = newContents.replace(/^version:.*$/m, `version: ${targetVersion}`);
            newContents = newContents.replace(/^appVersion:.*$/m, `appVersion: "${targetVersion}"`);

            // Sync Dependencies: Only update children that actually had changes
            const depLines = newContents.match(/- name:\s*(.+)/g);
            if (depLines) {
                depLines.forEach(line => {
                    const depName = line.split(':')[1].trim();
                    const depStatus = getChangeStatus(diffContext, depName);
                    const depDirChanged = diffFiles.includes(`/${depName}/`);
                    
                    if (depStatus.hasActualChanges || depDirChanged || globalChanged) {
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
            
            // Rule: Metadata Only (Image/Tag/Config/Secret) + No Template changes
            if (changeStatus.isMetadataOnly && !templatesChanged && !globalChanged) {
                console.log(`📝 [CHILD] ${chartName} (Metadata Only) -> appVersion: ${targetVersion}`);
                newContents = newContents.replace(/^appVersion:.*$/m, `appVersion: "${targetVersion}"`);
            } else {
                // Rule: Full Bump (Template or non-metadata values changed)
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

console.log(`\n✅ All charts processed for version ${targetVersion}`);