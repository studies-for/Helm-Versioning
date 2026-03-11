const fs = require('fs');
const yaml = require('js-yaml');

// This reads the current version from the YAML
module.exports.readVersion = function(contents) {
  return yaml.load(contents).version;
};

// This writes the new versions based on your specific rules
module.exports.writeVersion = function(contents, version) {
  const doc = yaml.load(contents);
  const suitePrefix = "22.4";

  // Your Business Rule:
  // 1. Chart version follows the release version (e.g., 4.1.6)
  doc.version = version; 
  
  // 2. appVersion follows the Suite format (e.g., 22.4.4.1.6)
  doc.appVersion = `${suitePrefix}.${version}`; 
  
  return yaml.dump(doc, { lineWidth: -1 });
};