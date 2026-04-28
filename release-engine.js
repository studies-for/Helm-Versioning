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

// 1. Get the last tag to compare total changes since the last release
let baseRef = "";
try {
    baseRef = execSync('git describe --tags --abbrev=0').toString().trim();
    console.log(`ℹ️ Comparing changes since last release tag: ${baseRef}`);
} catch (e) {
    baseRef = "HEAD^";
    console.log(`ℹ️ No tags found. Comparing against previous commit.`);
}

// 2. Fetch total diff with enough context to see parent headers
let diffFiles = "";
let diffContext = "";
try {
    diffFiles = execSync(`git diff --name-only ${baseRef} HEAD`).toString();
    // We get a large context to ensure we can see the "child-x:" headers above the changed lines
    diffContext = execSync(`git diff -U50 ${baseRef} HEAD`).toString();
} catch (e) {
    console.error("❌ Error fetching git diff.");
    process.exit(1);
}

/**
 * Parses the diff to see if a specific service block was modified
 * and what keywords were involved.
 */
function getChangeType(diffText, targetService) {
    const lines = diffText.split('\n');
    let currentServiceInDiff = null;
    let hasChanges = false;
    let hasMetadataKeywords = false;

    for (let line of lines) {
        // Find top-level service headers (e.g., "child-1:")
        // Matches keys that start at the beginning of the line (no indentation)
        const headerMatch = line.match(/^([\w-]+):/);
        if (headerMatch && !line.startsWith('+') && !line.startsWith('-')) {
            currentServiceInDiff = headerMatch[1];
        }

        // If we find an ADDED line (+)
        if (line.startsWith('+') && !line.startsWith('+++')) {
            // Check if this addition belongs to our target service
            if (currentServiceInDiff === targetService) {
                hasChanges = true;
                // Check if the specific added line contains metadata keywords
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

    // 3. RUN SMART DETECTION
    const isGlobalChanged = diffFiles.includes('global-values.yaml');
    const hasTemplateChanges = diffFiles.includes(`${chartDir}/templates/`);
    const { hasChanges, hasMetadataKeywords } = getChangeType(diffContext, chartName);

    let updatedContents = chartContents;

    if (isParent) {
        const parentPrefix = chartName.toLowerCase().split('-')[1]; 
        const isMyDomainValuesChanged = diffFiles.includes(`${parentPrefix}-values.yaml`);

        // Parent updates if its domain values changed, its own templates changed, or Global changed
        if (isMyDomainValuesChanged || isGlobalChanged || hasTemplateChanges) {
            console.log(`>>> [PARENT] Bumping ${chartName}`);
            updatedContents = updatedContents.replace(/^version:.*$/m, `version: ${inputVersion}`);
            updatedContents = updatedContents.replace(/^appVersion:.*$/m, `appVersion: ${fullAppVersion}`);
            updatedContents = updatedContents.replace(/(- name:.*\n\s+version:)\s*[\d.]+/g, `$1 ${inputVersion}`);
        }
    } else {
        // CHILD LOGIC
        if (hasMetadataKeywords && !hasTemplateChanges && !isGlobalChanged) {
            // Only appVersion changes if it's strictly Metadata
            console.log(`>>> [CHILD] Metadata Update (appVersion only): ${chartName}`);
            updatedContents = updatedContents.replace(/^appVersion:.*$/m, `appVersion: ${fullAppVersion}`);
        } 
        else if (hasTemplateChanges || hasChanges || isGlobalChanged) {
            // Full update if templates changed or non-metadata values changed
            console.log(`>>> [CHILD] Full Update (Version + appVersion): ${chartName}`);
            updatedContents = updatedContents.replace(/^version:.*$/m, `version: ${inputVersion}`);
            updatedContents = updatedContents.replace(/^appVersion:.*$/m, `appVersion: ${fullAppVersion}`);
        }
    }

    if (updatedContents !== chartContents) {
        fs.writeFileSync(chartPath, updatedContents);
    }
});

console.log(`✅ Finished processing version: ${inputVersion}`);