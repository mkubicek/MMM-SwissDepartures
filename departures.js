/* Shared, dependency-free departure logic. */
(function(root) {
  "use strict";
  var zone = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  });
  function parts(ms) {
    var p = {};
    zone.formatToParts(new Date(ms)).forEach(function(v) { p[v.type] = v.value; });
    return p;
  }
  function localUTC(ms) {
    var p = parts(ms);
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  }
  function parseTime(value) {
    if (typeof value !== "string") return NaN;
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value);
    if (!m) return NaN;
    var wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    // Explicit Swiss timezone, regardless of the server/browser timezone.
    // On the autumn repeated hour the feed cannot distinguish the two instants.
    var candidates = [wall - 7200000, wall - 3600000];
    return candidates.filter(function(t) { return localUTC(t) === wall; })[0] || NaN;
  }
  function delay(value) {
    return typeof value === "number" && Number.isFinite(value) ? value :
      (typeof value === "string" && /^[+-]?\d+$/.test(value) ? Number(value) : null);
  }
  function normalize(data, board) {
    if (!data || !data.stop || String(data.stop.id) !== String(board.stop) || !Array.isArray(data.connections)) {
      throw new Error("Invalid departure board response");
    }
    // Stop IDs and line names may be written as numbers or strings in config.js.
    var lines = board.lines && board.lines.map(String), via = board.via ? String(board.via) : "";
    var terminals = board.terminals && board.terminals.map(String);
    return data.connections.filter(function(c) {
      return (!lines || lines.indexOf(String(c.line)) !== -1) &&
        (!via || (c.subsequent_stops || []).some(function(s) { return String(s.id) === via; })) &&
        (!terminals || (c.terminal && terminals.indexOf(String(c.terminal.id)) !== -1));
    }).map(function(c) {
      var scheduled = parseTime(c.time);
      var minutes = delay(c.dep_delay);
      // Preserve nonnumeric status text rather than treating it as on time.
      // Cancellation encoding is not specified in the public API documentation; search.ch
      // marks cancelled runs with "X" as the delay (on the stop and every subsequent stop).
      var status = minutes === null && c.dep_delay != null ? String(c.dep_delay) : "";
      var cancelled = /^(x|cancelled|canceled|ausfall|fällt aus)$/i.test(status) || c.cancelled === true;
      return {
        line: c.line, destination: c.terminal ? c.terminal.name : "",
        scheduled: scheduled, expected: scheduled + (minutes || 0) * 60000,
        delay: minutes, status: status, cancelled: cancelled,
        track: String(c.track || "").replace(/!/g, ""), trackChanged: /!/.test(c.track || "")
      };
    }).filter(function(c) { return Number.isFinite(c.scheduled); });
  }
  function visible(rows, now, limit) {
    return rows.filter(function(c) { return (c.cancelled ? c.scheduled : c.expected) >= now; })
      .sort(function(a, b) { return a.expected - b.expected; }).slice(0, limit);
  }
  function clock(ms) { var p = parts(ms); return p.hour + ":" + p.minute; }
  function pollInterval(ms) {
    var p = parts(ms), minute = (+p.hour % 24) * 60 + +p.minute;
    if (minute >= 60 && minute < 360) return 300000;
    if (minute >= 390 && minute < 570) return 15000;
    return 30000;
  }
  function timing(row, now, walk) {
    var remaining = Math.max(0, Math.ceil((row.expected - now) / 60000));
    var leave = Math.floor((row.expected - now) / 60000 - walk);
    return { remaining: remaining, leave: leave };
  }
  /*
   * One compact line per board: the next `limit` departures you can still catch, and when to
   * leave for the first of them. Trains that are gone before you could reach them are skipped.
   */
  function summary(rows, now, walk, limit) {
    walk = Math.max(0, Number(walk) || 0);
    var shown = rows.filter(function(r) {
      return (r.cancelled ? r.scheduled : r.expected) >= now && (r.cancelled || timing(r, now, walk).leave >= 0);
    }).sort(function(a, b) { return a.expected - b.expected; }).slice(0, limit).map(function(r) {
      var t = timing(r, now, walk);
      return { minutes: t.remaining, leave: t.leave, clock: clock(r.expected), scheduled: clock(r.scheduled), delay: r.delay, status: r.status,
        cancelled: r.cancelled, trackChanged: r.trackChanged, track: r.track, destination: r.destination };
    });
    var first = shown.filter(function(d) { return !d.cancelled; })[0];
    return { departures: shown, leave: first ? first.leave : null };
  }
  var api = { parseTime: parseTime, delay: delay, normalize: normalize, visible: visible, clock: clock, timing: timing, pollInterval: pollInterval, summary: summary };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SwissDepartures = api;
})(typeof window !== "undefined" ? window : this);
