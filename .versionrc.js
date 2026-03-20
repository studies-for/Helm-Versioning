const glob = require('glob');

// Finds every Chart.yaml in your structure
const charts = glob.sync("Immutable/**/Chart.yaml");

const bumpFiles = [
  { filename: "package.json", type: "json" }
];

charts.forEach(file => {
  bumpFiles.push({
    filename: file,
    updater: "scripts/helm-updater.js"
  });
});

module.exports = {
  bumpFiles: bumpFiles,
  // This ensures we only create ONE git tag for the whole release (e.g., v4.1.7)
  packageFiles: [{ filename: "package.json", type: "json" }]
};
