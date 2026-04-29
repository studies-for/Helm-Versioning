const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const glob = require('glob');

/**
 * 1. INPUT & BASELINE
 */
const inputVersion = process.argv[2];
if (!inputVersion) {
    console.error("❌ Error: Please provide a version number.");
    process.exit(1);
}

let baseRef = "";
try {
    baseRef = execSync('git describe --tags --abbrev=0').toString().trim();
    console.log(`ℹ️  Comparing changes since ${baseRef}`);
} catch (e) {
    baseRef = "HEAD^";
    console.log(`ℹ️  No tags found. Using HEAD^.`);
}

let diffFiles = "";
let diffContext = "";
try {
    diffFiles = execSync(`git diff --name-only ${baseRef} HEAD`).toString();
    diffContext = execSync(`git diff -U50 ${baseRef} HEAD`).toString();
} catch (e) {
    console.error("❌ Error: Git diff failed.");
    process.exit(1);
}

/**
 * 2. HELPER: DETECTION LOGIC
 */
function getChangeStatus(diffText, chartName) {
    const lines = diffText.split('\n');
    let currentBlock = null;
    let hasChanges = false;
    for (let line of lines) {
        const headerMatch = line.match(/^[ +-]([^\s][\w-]+):/);
        if (headerMatch) currentBlock = headerMatch[1];
        if (line.startsWith('+') && !line.startsWith('+++')) {
            if (currentBlock === chartName) {
                hasChanges = true;
                break;
            }
        }
    }
    return hasChanges;
}

/**
 * 3. DYNAMIC PROCESSING
 */
const allCharts = glob.sync("Immutable/**/Chart.yaml");

allCharts.forEach(chartPath => {
    const originalContents = fs.readFileSync(chartPath, 'utf8');
    const chartDir = path.dirname(chartPath);
    const chartName = (originalContents.match(/^name:\s*(.+)/m) || [])[1]?.trim();
    const isParent = originalContents.includes('type: application');

    // MAPPING LOGIC
    // Get Parent Folder Name (e.g. IGCB-ARX22)
    const pathParts = chartPath.split(path.sep);
    const parentDirName = pathParts[1]; 
    
    // Corresponding Mutable File (e.g. mutable/DIT/igcb-arx22.yaml)
    const mutableFilePath = `mutable/DIT/${parentDirName.toLowerCase()}.yaml`;

    // 4. DETECT CHANGE TYPES
    const isGlobalChanged = diffFiles.includes('global-values.yaml');
    const isMutableFileChanged = diffFiles.includes(mutableFilePath);
    const isInternalValuesChanged = diffFiles.includes(path.join(chartDir, 'values.yaml'));
    const isTemplateChanged = diffFiles.includes(path.join(chartDir, 'templates'));
    
    // Check if the specific service block changed inside the mutable file or subchart values
    const isServiceConfigChanged = getChangeStatus(diffContext, chartName);

    let newContents = originalContents;
    let updateType = null; // 'full' (version+appVersion) or 'metadata' (appVersion only)

    if (isGlobalChanged || isTemplateChanged) {
        updateType = 'full';
    } else if (isMutableFileChanged && isServiceConfigChanged) {
        updateType = 'metadata';
    } else if (isInternalValuesChanged) {
        updateType = 'metadata';
    }

    if (updateType || isParent) {
        if (isParent) {
            // Parent logic: Updates if global changed, its mutable file changed, or its sub-templates changed
            if (isGlobalChanged || isMutableFileChanged || diffFiles.includes(parentDirName)) {
                console.log(`🚀 [PARENT] ${chartName} -> ${inputVersion}`);
                newContents = newContents.replace(/^version:.*$/m, `version: ${inputVersion}`);
                newContents = newContents.replace(/^appVersion:.*$/m, `appVersion: "${inputVersion}"`);
                
                // Sync Dependencies
                const depLines = newContents.match(/- name:\s*(.+)/g);
                if (depLines) {
                    depLines.forEach(line => {
                        const depName = line.split(':')[1].trim();
                        if (diffFiles.includes(depName) || isGlobalChanged || isMutableFileChanged) {
                            const reg = new RegExp(`(- name: ${depName}\\r?\\n\\s+version:)\\s*[\\d.]+`, 'g');
                            newContents = newContents.replace(reg, `$1 ${inputVersion}`);
                        }
                    });
                }
            }
        } else if (updateType === 'full') {
            console.log(`🔥 [CHILD] ${chartName} (Full Update: Templates/Global) -> ${inputVersion}`);
            newContents = newContents.replace(/^version:.*$/m, `version: ${inputVersion}`);
            newContents = newContents.replace(/^appVersion:.*$/m, `appVersion: "${inputVersion}"`);
        } else if (updateType === 'metadata') {
            console.log(`📝 [CHILD] ${chartName} (Metadata Update: Config/Values) -> appVersion: ${inputVersion}`);
            newContents = newContents.replace(/^appVersion:.*$/m, `appVersion: "${inputVersion}"`);
        }
    }

    if (newContents !== originalContents) {
        fs.writeFileSync(chartPath, newContents);
    }
});

console.log(`\n✅ Processing complete for version ${inputVersion}`);