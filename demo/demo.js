/* Just enough of MagicMirror² (Module.register, file, updateDom, socket notifications) to run the
 * real module front end against the demo server's synthetic departures. The page clock is shifted
 * to ?at=HH:MM[:SS] Europe/Zurich time (default 08:07:30) so the preview always looks the same. */
(function () {
	"use strict";
	var definition = null;
	var params = new URLSearchParams(location.search);

	window.Module = {
		register: function (name, module) { definition = module; }
	};

	// Shift Date.now() to the requested Zurich wall-clock time today; it keeps ticking from there.
	function zurichOffset(ms) {
		var p = {};
		new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", hour12: false, year: "numeric", month: "2-digit",
			day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
			.formatToParts(new Date(ms)).forEach(function (v) { p[v.type] = v.value; });
		return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
	}
	var at = (params.get("at") || "08:07:30").split(":").map(Number);
	var realNow = Date.now.bind(Date), real = realNow();
	var wall = real + zurichOffset(real);
	var day = wall - (wall % 86400000);
	var target = day + ((at[0] || 0) * 3600 + (at[1] || 0) * 60 + (at[2] || 0)) * 1000 - zurichOffset(real);
	var shift = target - real;
	Date.now = function () { return realNow() + shift; };
	var origin = Date.now();

	window.SwissDeparturesDemo = {
		start: function () {
			var module = Object.create(definition);
			module.identifier = "demo";
			module.config = Object.assign({}, definition.defaults);
			module.file = function (name) { return "/" + name; };
			module.updateDom = function () {
				var content = document.getElementById("content");
				content.innerHTML = "";
				content.appendChild(module.getDom());
			};
			// The node_helper's reply, computed by the demo server from made-up stationboards.
			module.sendSocketNotification = function (name, payload) {
				fetch("/data", { method: "POST", body: JSON.stringify({ boards: payload.boards, origin: origin, now: Date.now(), state: params.get("state") }) })
					.then(function (response) { return response.json(); })
					.then(function (replies) { replies.forEach(function (reply) { module.socketNotificationReceived("DEPARTURES_DATA", reply); }); });
			};
			module.start();
		}
	};
}());
