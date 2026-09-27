"use strict";
// Preview of the real module front end with SYNTHETIC departures: no MagicMirror, no network.
// `npm run demo`, then open http://localhost:3460
//   ?at=08:07:30     wall-clock time (Europe/Zurich) the demo pretends it is (default 08:07:30)
//   ?state=offline   the last request failed and the data is three minutes old
//   ?state=stale     the data is three minutes old (no error)
const http = require("http");
const fs = require("fs");
const path = require("path");
const departures = require("../departures");

// The module's own defaults: S7 at Zürich Stadelhofen (both directions) and tram 11 at Bellevue.
// Timetable-like but made up. At the default 08:07:30 start this shows an S7 delayed by three
// minutes, a tram you should leave for now, and trams/trains you can no longer catch (skipped).
const STOPS = {
	"8503003": { name: "Zürich Stadelhofen", runs: [
		{ at: 7.5, line: "S7", terminal: ["8506000", "Winterthur"], via: "8503000", delay: "+0", track: "1" },
		{ at: 6.5, line: "S7", terminal: ["8503110", "Rapperswil SG"], via: "8503104", delay: "+3", track: "2" },
		{ at: 3.5, line: "S6", terminal: ["8503504", "Baden"], via: "8503000", delay: "+0", track: "1" },
		{ at: 10.5, line: "S16", terminal: ["8503103", "Herrliberg-Feldmeilen"], via: "8503104", delay: "+1", track: "2" },
		{ at: 37.5, line: "S7", terminal: ["8506000", "Winterthur"], via: "8503000", delay: "+0", track: "1" },
		{ at: 36.5, line: "S7", terminal: ["8503110", "Rapperswil SG"], via: "8503104", delay: "+0", track: "2" }
	] },
	"8576193": { name: "Zürich, Bellevue", runs: [
		{ at: 1.5, line: "11", terminal: ["8591067", "Zürich, Bahnhofstrasse/HB"], via: "8591299", delay: "+0", track: "D" },
		{ at: 3.5, line: "11", terminal: ["8591067", "Zürich, Bahnhofstrasse/HB"], via: "8591299", delay: "+0", track: "D" },
		{ at: 5.5, line: "4", terminal: ["8591067", "Zürich, Bahnhofstrasse/HB"], via: "8588078", delay: "+0", track: "A" },
		{ at: 10.5, line: "11", terminal: ["8591067", "Zürich, Bahnhofstrasse/HB"], via: "8591299", delay: "+0", track: "D" },
		{ at: 11.5, line: "11", terminal: ["8576182", "Zürich Tiefenbrunnen, Bahnhof"], via: "8576195", delay: "+0", track: "C" }
	] }
};

const zurich = new Intl.DateTimeFormat("en-GB", {
	timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit",
	hour: "2-digit", minute: "2-digit", hour12: false
});
function stamp(ms) {
	const p = {};
	zurich.formatToParts(new Date(ms)).forEach((v) => { p[v.type] = v.value; });
	return p.year + "-" + p.month + "-" + p.day + " " + (+p.hour % 24 < 10 ? "0" : "") + (+p.hour % 24) + ":" + p.minute + ":00";
}

// A stationboard.json-shaped response, so the real departures.normalize() does the filtering.
// `origin` is the moment the demo started; run offsets are minutes after it.
function stationboard(stop, origin) {
	return {
		stop: { id: stop, name: STOPS[stop].name },
		connections: STOPS[stop].runs.map((run) => ({
			time: stamp(origin + run.at * 60000),
			line: run.line,
			terminal: { id: run.terminal[0], name: run.terminal[1] },
			dep_delay: run.delay,
			track: run.track,
			subsequent_stops: [{ id: run.via }, { id: run.terminal[0] }]
		})).sort((a, b) => (a.time < b.time ? -1 : 1))
	};
}

function data(boards, origin, now, state) {
	const age = state === "offline" || state === "stale" ? 180000 : 2000;
	return boards.slice(0, 3).map((board, index) => ({
		identifier: "demo", index: index,
		rows: departures.normalize(stationboard(board.stop, origin), board),
		fetchedAt: now - age, error: state === "offline",
		nextAttemptAt: now + departures.pollInterval(now)
	}));
}

const FILES = {
	"/": ["demo/index.html", "text/html"],
	"/demo.js": ["demo/demo.js", "text/javascript"],
	"/MMM-SwissDepartures.js": ["MMM-SwissDepartures.js", "text/javascript"],
	"/MMM-SwissDepartures.css": ["MMM-SwissDepartures.css", "text/css"],
	"/departures.js": ["departures.js", "text/javascript"]
};

http.createServer((req, res) => {
	const url = new URL(req.url, "http://localhost");
	if (url.pathname === "/data" && req.method === "POST") {
		let body = "";
		req.on("data", (chunk) => { body += chunk; });
		req.on("end", () => {
			try {
				const input = JSON.parse(body);
				res.setHeader("Content-Type", "application/json");
				res.end(JSON.stringify(data(input.boards, Number(input.origin), Number(input.now), input.state)));
			} catch (error) {
				res.statusCode = 400;
				res.end(error.message);
			}
		});
		return;
	}
	const file = FILES[url.pathname];
	if (!file) {
		res.statusCode = 404;
		return res.end("Not found");
	}
	res.setHeader("Content-Type", file[1]);
	res.setHeader("Cache-Control", "no-store");
	res.end(fs.readFileSync(path.join(__dirname, "..", file[0])));
}).listen(Number(process.env.PORT || 3460), "127.0.0.1", () => {
	console.log("MMM-SwissDepartures demo: http://localhost:" + (process.env.PORT || 3460));
});
