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

// 1. Get the last release tag for delta comparison
let baseRef = "";
try {
    baseRef = execSync('git describe --tags --abbrev=0').toString().trim();
    console.log(`ℹ️ Comparing changes since: ${baseRef}`);
} catch (e) {
    baseRef = "HEAD^";
    console.log(`ℹ️ No tags found. Using HEAD^`);
}

// 2. Fetch Diffs
let diffFiles = "";
let diffContext = "";
try {
    diffFiles = execSync(`git diff --name-only ${baseRef} HEAD`).toString();
    // Use large context to capture headers like "idc-1:" above the actual "+" lines
    diffContext = execSync(`git diff -U50 ${baseRef} HEAD`).toString();
} catch (e) {
    console.error("❌ Error fetching git diff.");
    process.exit(1);
}

/**
 * STRICT DETECTION: Checks if a service actually has "+" changes under its header.
 */
function getStrictChangeInfo(diffText, targetService) {
    const lines = diffText.split('\n');
    let currentServiceInDiff = null;
    let hasRealChanges = false;
    let hasMetadataKeywords = false;

    for (let line of lines) {
        // Detect headers (e.g., "idc-1:", "child-2:") allowing for git prefixes (space, +, -)
        const headerMatch = line.match(/^[ +-](([\w-]+):)/);
        if (headerMatch) {
            currentServiceInDiff = headerMatch[2];
        }

        // Only count lines starting with "+" (Actual additions/changes)
        if (line.startsWith('+') && !line.startsWith('+++')) {
            if (currentServiceInDiff === targetService) {
                hasRealChanges = true;
                if (/image:|configmap:|secret:|tag:|repository:/i.test(line)) {
                    hasMetadataKeywords = true;
                }
            }
        }
    }
    return { hasRealChanges, hasMetadataKeywords };
}

const charts = glob.sync("Immutable/**/Chart.yaml");

charts.forEach(chartPath => {
    const chartContents = fs.readFileSync(chartPath, 'utf8');
    const chartDir = path.dirname(chartPath);
    const nameMatch = chartContents.match(/^name:\s*(.+)/m);
    const chartName = nameMatch ? nameMatch[1].trim() : "";
    const isParent = chartContents.includes('type: application');

    // 3. RUN DETECTION
    const isGlobalChanged = diffFiles.includes('global-values.yaml');
    const hasTemplateChanges = diffFiles.includes(`${chartDir}/templates`);
    const { hasRealChanges, hasMetadataKeywords } = getStrictChangeInfo(diffContext, chartName);

    let updatedContents = chartContents;

    if (isParent) {
        // Determine domain from folder path (ARX or IDC)
        const domain = chartPath.includes('/ARX/') ? 'arx' : 'idc';
        const isDomainValuesChanged = diffFiles.includes(`${domain}-values.yaml`);

        // Parent bumps if: Global changed OR Domain values changed OR its own templates changed
        if (isGlobalChanged || isDomainValuesChanged || hasTemplateChanges) {
            console.log(`>>> [PARENT] Bumping ${chartName}`);
            updatedContents = updatedContents.replace(/^version:.*$/m, `version: ${inputVersion}`);
            updatedContents = updatedContents.replace(/^appVersion:.*$/m, `appVersion: ${fullAppVersion}`);

            // SYNC DEPENDENCIES: Only bump dependencies that actually have changes
            const depLines = updatedContents.match(/- name:\s*(.+)/g);
            if (depLines) {
                depLines.forEach(line => {
                    const depName = line.split(':')[1].trim();
                    const depPath = `${chartDir}/charts/${depName}`;
                    
                    // Check if this specific dependency has real changes in diff
                    const depInfo = getStrictChangeInfo(diffContext, depName);
                    const depFolderChanged = diffFiles.includes(depPath);

                    if (depInfo.hasRealChanges || depFolderChanged || isGlobalChanged) {
                        console.log(`    -> Syncing dependency: ${depName}`);
                        const regex = new RegExp(`(- name: ${depName}\\n\\s+version:)\\s*[\\d.]+`, 'g');
                        updatedContents = updatedContents.replace(regex, `$1 ${inputVersion}`);
                    }
                });
            }
        }
    } else {
        // CHILD LOGIC
        if (hasMetadataKeywords && !hasTemplateChanges && !isGlobalChanged) {
            console.log(`>>> [CHILD] Metadata Update: ${chartName}`);
            updatedContents = updatedContents.replace(/^appVersion:.*$/m, `appVersion: ${fullAppVersion}`);
        } 
        else if (hasTemplateChanges || hasRealChanges || isGlobalChanged) {
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