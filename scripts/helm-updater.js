const yaml = require('js-yaml');

module.exports.readVersion = function(contents) {
  try {
    const doc = yaml.load(contents);
    if (!doc || !doc.version) {
      console.error(">>> ERROR: Could not find 'version' field in the YAML contents.");
      return "0.0.0"; // Fallback to avoid the 'undefined' error
    }
    return doc.version.toString(); 
  } catch (e) {
    console.error(">>> ERROR parsing YAML:", e);
    return "0.0.0";
  }
};

module.exports.writeVersion = function(contents, version) {
  try {
    const doc = yaml.load(contents);
    const suitePrefix = "22.4";

    // Update the fields
    doc.version = version;
    doc.appVersion = `${suitePrefix}.${version}`;

    // Return the updated YAML string
    // lineWidth: -1 prevents line wrapping for long lines
    return yaml.dump(doc, { lineWidth: -1, noArrayIndent: true });
  } catch (e) {
    console.error(">>> ERROR writing YAML:", e);
    return contents;
  }
};