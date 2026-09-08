// Metro must not crawl the backend projects that share this repo: server/ (Next.js) and
// server-spring/ each carry their own node_modules and lockfile, and a second React in the
// haste map is the kind of duplicate that breaks the native bundle in confusing ways.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const config = getDefaultConfig(__dirname);

const escape = (dir) => dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const backends = ["server", "server-spring"].map(
  (dir) => new RegExp(`^${escape(path.join(__dirname, dir))}/.*`)
);
config.resolver.blockList = [...(config.resolver.blockList ?? []), ...backends].flat();

module.exports = config;
