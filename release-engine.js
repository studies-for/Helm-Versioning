const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const glob = require('glob');

const inputVersion = process.argv[2];
if (!inputVersion) {
    console.error("❌ Error: Please provide a version number.");
    process.exit(1);
}

let baseRef = "";
try {
    baseRef = execSync('git describe --tags --abbrev=0').toString().trim();
} catch (e) {
    baseRef = "HEAD^";
}

let diffFiles = "";
let diffContent = "";
try {
    // We get the list of files and the content diff
    diffFiles = execSync(`git diff --name-only ${baseRef} HEAD`).toString();
    diffContent = execSync(`git diff -U20 ${baseRef} HEAD`).toString();
} catch (e) {
    console.error("❌ Error: Git diff failed.");
    process.exit(1);
}

/**
 * Checks which service header a change belongs to and if it contains keywords
 */
function getChartChangeInfo(diffText, targetService) {
    const lines = diffText.split('\n');
    let currentBlock = null;
    let hasChanges = false;
    let isMetadata = false;

    for (let line of lines) {
        // Matches top-level YAML keys like "idc-1:"
        const headerMatch = line.match(/^[ +-](([^\s][\w-]+):)/);
        if (headerMatch) currentBlock = headerMatch[2];

        if (line.startsWith('+') && !line.startsWith('+++')) {
            if (currentBlock === targetService) {
                hasChanges = true;
                if (/image:|configmap:|secret:|tag:|repository:/i.test(line)) {
                    isMetadata = true;
                }
            }
        }
    }
    return { hasChanges, isMetadata };
}

const allCharts = glob.sync("Immutable/**/Chart.yaml");

allCharts.forEach(chartPath => {
    const originalContents = fs.readFileSync(chartPath, 'utf8');
    const chartDir = path.dirname(chartPath);
    const chartName = (originalContents.match(/^name:\s*(.+)/m) || [])[1]?.trim();
    const isParent = originalContents.includes('type: application');

    // DOMAIN MAPPING
    // If path is Immutable/IDC/Chart.yaml, parentDirName is IDC
    const pathParts = chartPath.split(/[\\/]/); // Handles both Windows and Linux paths
    const parentDirName = pathParts[1]; 
    
    // Maps IDC -> mutable/UAT/idc-values.yaml
    const mutableFilePath = `mutable/UAT/${parentDirName.toLowerCase()}-values.yaml`;

    // DETECTION FLAGS
    const isGlobalChanged = diffFiles.includes('global-values.yaml');
    const isDomainValuesChanged = diffFiles.includes(mutableFilePath);
    const isInternalValuesChanged = diffFiles.includes(path.join(chartDir, 'values.yaml'));
    const isTemplateChanged = diffFiles.includes(path.join(chartDir, 'templates'));
    
    const changeInfo = getChartChangeInfo(diffContent, chartName);

    let newContents = originalContents;
    let updateType = null; // 'full' or 'metadata'

    // Determine if this specific chart should update
    if (isGlobalChanged || isTemplateChanged) {
        updateType = 'full';
    } else if (isInternalValuesChanged || (isDomainValuesChanged && changeInfo.hasChanges)) {
        updateType = changeInfo.isMetadata ? 'metadata' : 'full';
    }

    // SPECIAL PARENT LOGIC: Only update if the Parent's domain was touched
    if (isParent) {
        // A parent only updates if: its domain values changed, its own templates changed, or global changed
        if (isGlobalChanged || isDomainValuesChanged || isTemplateChanged) {
            let parentUpdateType = (isGlobalChanged || isTemplateChanged) ? 'full' : 'metadata';
            
            console.log(`🚀 [PARENT] Processing ${chartName} (${parentUpdateType} update)`);
            
            if (parentUpdateType === 'full') {
                newContents = newContents.replace(/^version:.*$/m, `version: ${inputVersion}`);
            }
            newContents = newContents.replace(/^appVersion:.*$/m, `appVersion: "${inputVersion}"`);
            
            // Sync Dependencies: Only update child version if the child had a FULL update
            const depLines = newContents.match(/- name:\s*(.+)/g);
            if (depLines) {
                depLines.forEach(line => {
                    const depName = line.split(':')[1].trim();
                    const depDir = path.join(chartDir, 'charts', depName);
                    const depTemplateChanged = diffFiles.includes(path.join(depDir, 'templates'));
                    
                    if (isGlobalChanged || depTemplateChanged) {
                        console.log(`    -> Syncing Dependency VERSION: ${depName}`);
                        const reg = new RegExp(`(- name: ${depName}\\r?\\n\\s+version:)\\s*[\\d.]+`, 'g');
                        newContents = newContents.replace(reg, `$1 ${inputVersion}`);
                    }
                });
            }
        }
    } else if (updateType) {
        // CHILD UPDATE
        if (updateType === 'full') {
            console.log(`🔥 [CHILD] ${chartName} (Full Update) -> ${inputVersion}`);
            newContents = newContents.replace(/^version:.*$/m, `version: ${inputVersion}`);
            newContents = newContents.replace(/^appVersion:.*$/m, `appVersion: "${inputVersion}"`);
        } else {
            console.log(`📝 [CHILD] ${chartName} (Metadata Only) -> appVersion: ${inputVersion}`);
            newContents = newContents.replace(/^appVersion:.*$/m, `appVersion: "${inputVersion}"`);
        }
    }

    if (newContents !== originalContents) {
        fs.writeFileSync(chartPath, newContents);
    }
});

console.log(`\n✅ Done!`);