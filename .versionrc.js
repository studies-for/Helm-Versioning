const glob = require('glob');

// This will find ARX/Chart.yaml, ARX/child-1/Chart.yaml, IDC/Chart.yaml, etc.
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
  packageFiles: [{ filename: "package.json", type: "json" }]
};
