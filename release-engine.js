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

// 1. Get the last tag
let baseRef = "";
try {
    baseRef = execSync('git describe --tags --abbrev=0').toString().trim();
    console.log(`ℹ️ Comparing changes since: ${baseRef}`);
} catch (e) {
    baseRef = "HEAD^";
    console.log(`ℹ️ No tags found. Comparing against HEAD^`);
}

// 2. Fetch Diff
let diffFiles = "";
let diffContext = "";
try {
    diffFiles = execSync(`git diff --name-only ${baseRef} HEAD`).toString();
    // We use -U20 to get enough context to find the "child-x:" headers
    diffContext = execSync(`git diff -U20 ${baseRef} HEAD`).toString();
} catch (e) {
    console.error("❌ Error fetching git diff.");
    process.exit(1);
}

/**
 * FIXED: Detects service blocks by allowing for the Git Diff prefix (space, +, -)
 */
function getChangeType(diffText, targetService) {
    const lines = diffText.split('\n');
    let currentServiceInDiff = null;
    let hasChanges = false;
    let hasMetadataKeywords = false;

    for (let line of lines) {
        // Regex update: Look for a line starting with space/+/-, 
        // then the service name at the start of the YAML key (no indentation)
        const headerMatch = line.match(/^[ +-](([\w-]+):)/);
        
        if (headerMatch) {
            // Extract the service name (e.g., "child-2")
            currentServiceInDiff = headerMatch[2];
        }

        if (line.startsWith('+') && !line.startsWith('+++')) {
            if (currentServiceInDiff === targetService) {
                hasChanges = true;
                if (/image:|configmap:|secret:|tag:|repository:/i.test(line)) {
                    hasMetadataKeywords = true;
                }
            }
        }
    }
    return { hasChanges, hasMetadataKeywords };
}

const charts = glob.sync("Immutable/**/Chart.yaml");

charts.forEach(chartPath => {
    const chartContents = fs.readFileSync(chartPath, 'utf8');
    const chartDir = chartPath.replace('/Chart.yaml', '');
    const nameMatch = chartContents.match(/^name:\s*(.+)/m);
    const chartName = nameMatch ? nameMatch[1].trim() : "";
    const isParent = chartContents.includes('type: application');

    // 3. RUN DETECTION
    const isGlobalChanged = diffFiles.includes('global-values.yaml');
    const hasTemplateChanges = diffFiles.includes(`${chartDir}/templates/`);
    const { hasChanges, hasMetadataKeywords } = getChangeType(diffContext, chartName);

    let updatedContents = chartContents;

    if (isParent) {
        const parentPrefix = chartName.toLowerCase().split('-')[1]; // 'arx' or 'idc'
        const isMyValuesFileChanged = diffFiles.includes(`${parentPrefix}-values.yaml`);

        if (isMyValuesFileChanged || isGlobalChanged || hasTemplateChanges) {
            console.log(`>>> [PARENT] Bumping ${chartName}`);
            updatedContents = updatedContents.replace(/^version:.*$/m, `version: ${inputVersion}`);
            updatedContents = updatedContents.replace(/^appVersion:.*$/m, `appVersion: ${fullAppVersion}`);
            updatedContents = updatedContents.replace(/(- name:.*\n\s+version:)\s*[\d.]+/g, `$1 ${inputVersion}`);
        }
    } else {
        if (hasMetadataKeywords && !hasTemplateChanges && !isGlobalChanged) {
            console.log(`>>> [CHILD] Metadata Update: ${chartName}`);
            updatedContents = updatedContents.replace(/^appVersion:.*$/m, `appVersion: ${fullAppVersion}`);
        } 
        else if (hasTemplateChanges || hasChanges || isGlobalChanged) {
            console.log(`>>> [CHILD] Full Update: ${chartName}`);
            updatedContents = updatedContents.replace(/^version:.*$/m, `version: ${inputVersion}`);
            updatedContents = updatedContents.replace(/^appVersion:.*$/m, `appVersion: ${fullAppVersion}`);
        }
    }

    if (updatedContents !== chartContents) {
        fs.writeFileSync(chartPath, updatedContents);
    }
});

console.log(`✅ Processed version: ${inputVersion}`);