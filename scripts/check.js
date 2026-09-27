"use strict";
// Runtime files must parse as ES2018 (Node 10 on older Raspberry Pi installs, Electron 16 / Chrome 96)
// and the server side must not rely on globals Node 10 lacks.
const fs = require("fs");
const path = require("path");
const acorn = require("acorn");
const root = path.join(__dirname, "..");
const files = ["MMM-SwissDepartures.js", "departures.js", "feed.js", "node_helper.js"];
files.forEach((file) => {
	const source = fs.readFileSync(path.join(root, file), "utf8");
	acorn.parse(source, { ecmaVersion: 2018, sourceType: "script" });
	if (file !== "MMM-SwissDepartures.js" && /\bfetch\s*\(/.test(source)) throw new Error(file + ": fetch() is not available in Node 10");
});
console.log("ES2018 / Node 10 compatibility checked: " + files.length + " runtime files");
