"use strict";
const https = require("https");
const zlib = require("zlib");
const parseUrl = require("url").parse;
const departures = require("./departures");

// Boards on the same stop (e.g. both directions of a line) share one request per poll.
const recent = new Map();

function fetchBoard(board) {
  const cached = recent.get(board.stop);
  if (cached && Date.now() - cached.at < 5000) return cached.body.then(function(data) { return departures.normalize(data, board); });
  const body = fetchStop(board.stop);
  recent.set(board.stop, { at: Date.now(), body: body });
  return body.then(function(data) { return departures.normalize(data, board); });
}

function fetchStop(stop) {
  const url = "https://search.ch/timetable/api/stationboard.json?stop=" + encodeURIComponent(stop) +
    "&limit=30&show_delays=1&show_tracks=1&show_trackchanges=1&show_subsequent_stops=1";
  return new Promise(function(resolve, reject) {
    // gzip cuts a typical 50–80 KB board to about 10 KB per request.
    const options = Object.assign(parseUrl(url), { headers: { "Accept-Encoding": "gzip" } });
    const req = https.get(options, function(res) {
      if (res.statusCode !== 200) { res.resume(); reject(new Error("HTTP " + res.statusCode)); return; }
      let body = "";
      const gzip = /\bgzip\b/.test((res.headers && res.headers["content-encoding"]) || "");
      const stream = gzip ? res.pipe(zlib.createGunzip()) : res;
      stream.setEncoding("utf8");
      stream.on("data", function(chunk) {
        body += chunk;
        if (body.length > 2000000) req.destroy(new Error("Response too large"));
      });
      res.on("error", reject);
      if (gzip) stream.on("error", reject);
      stream.on("end", function() {
        try { resolve(JSON.parse(body)); }
        catch (error) { reject(error); }
      });
    });
    req.setTimeout(12000, function() { req.destroy(new Error("Request timed out")); });
    req.on("error", reject);
  });
}
module.exports = { fetchBoard: fetchBoard };
