// Sets automatic code signing for local device builds, so `expo run:ios --device`
// does not stop to ask for a team (and so `expo prebuild` does not lose the setting).
const { withXcodeProject } = require("@expo/config-plugins");

const TEAM_ID = "VG7Z97CTBC"; // Aleksa Stankovic — personal team

module.exports = function withSigning(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const configs = project.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configs)) {
      const entry = configs[key];
      if (typeof entry !== "object" || !entry.buildSettings) continue;
      if (!entry.buildSettings.PRODUCT_BUNDLE_IDENTIFIER) continue;
      entry.buildSettings.DEVELOPMENT_TEAM = TEAM_ID;
      entry.buildSettings.CODE_SIGN_STYLE = "Automatic";
    }
    return cfg;
  });
};
