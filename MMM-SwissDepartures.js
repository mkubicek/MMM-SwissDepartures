/* global Module, SwissDepartures */
Module.register("MMM-SwissDepartures", {
  defaults: {
    staleAfter: 90000, maximumEntries: 2,
    // Public examples; set your own stops in config.js (see README for finding stop IDs).
    boards: [
      // S7 at Zürich Stadelhofen, towards Zürich HB / towards Meilen. Both share one request.
      { label: "Zürich HB", stop: "8503003", lines: ["S7"], via: "8503000", walkingMinutes: 5 },
      { label: "Rapperswil", stop: "8503003", lines: ["S7"], via: "8503104", walkingMinutes: 5 },
      // Tram 11 at Zürich Bellevue, towards Paradeplatz.
      { label: "Paradeplatz", stop: "8576193", lines: ["11"], via: "8591299", walkingMinutes: 3 }
    ]
  },
  getScripts: function() { return [this.file("departures.js")]; },
  getStyles: function() { return ["MMM-SwissDepartures.css"]; },
  start: function() { this.states = []; this.begin(); },
  begin: function() {
    var self = this;
    clearInterval(this.renderTimer);
    this.fetch();
    this.renderTimer = setInterval(function() {
      var now = Date.now();
      // Re-evaluate the schedule every tick, including entry into the morning window.
      if (now >= Math.min(self.nextPollAt, self.lastRequestAt + SwissDepartures.pollInterval(now))) self.fetch();
      self.refresh();
    }, 1000);
  },
  fetch: function() {
    this.lastRequestAt = Date.now();
    this.nextPollAt = this.lastRequestAt + SwissDepartures.pollInterval(this.lastRequestAt);
    this.sendSocketNotification("DEPARTURES_FETCH", { identifier: this.identifier, boards: this.config.boards });
  },
  suspend: function() { clearInterval(this.renderTimer); },
  resume: function() { this.begin(); },
  socketNotificationReceived: function(name, payload) {
    if (name !== "DEPARTURES_DATA" || payload.identifier !== this.identifier) return;
    this.states[payload.index] = payload;
    if (Number.isFinite(payload.nextAttemptAt)) {
      this.nextPollAt = Math.min(this.nextPollAt, Math.max(Date.now() + 1000, payload.nextAttemptAt));
    }
    this.refresh();
  },
  /* Redraw only when something visible changed; the per-second tick is usually a no-op. */
  refresh: function() {
    var key = JSON.stringify(this.model(Date.now()));
    if (key === this.renderedKey) return;
    this.renderedKey = key;
    this.updateDom(0);
  },
  model: function(now) {
    var self = this, problems = [];
    var boards = this.config.boards.slice(0, 3).map(function(board, i) {
      var state = self.states[i];
      var label = board.label || (board.title || "").split(" → ").pop();
      if (!state || !state.fetchedAt) {
        if (state && state.error) problems.push("offline");
        return { line: (board.lines || [""])[0], label: label, loading: !state || !state.error };
      }
      var interval = SwissDepartures.pollInterval(now), lowRefresh = interval === 300000;
      var stale = now - state.fetchedAt >= Math.min(self.config.staleAfter, 3 * interval);
      // Scheduled overnight gaps are expected; keep conservative walking advice
      // without labelling a healthy, deliberately slow feed as broken.
      var overdue = lowRefresh ? now - state.fetchedAt >= 330000 : stale;
      if (state.error && stale) problems.push("offline");
      else if (overdue) problems.push(Math.max(1, Math.floor((now - state.fetchedAt) / 60000)));
      var sum = SwissDepartures.summary(state.rows, now, board.walkingMinutes, self.config.maximumEntries);
      return { line: (board.lines || [""])[0], label: label, unreliable: stale || !!state.error,
        departures: sum.departures, leave: sum.leave };
    });
    return { boards: boards, problem: problems.indexOf("offline") !== -1 ? "offline" :
      problems.length ? Math.max.apply(null, problems) : null };
  },
  getDom: function() {
    var model = this.model(Date.now()), root = document.createElement("div");
    root.className = "swiss-departures";
    function el(tag, text, cls, parent) {
      var node = document.createElement(tag); node.textContent = text;
      if (cls) node.className = cls;
      parent.appendChild(node); return node;
    }
    model.boards.forEach(function(b) {
      var row = el("div", "", "sd-row", root);
      el("span", b.line, "sd-line", row);
      el("span", b.label, "sd-label", row);
      if (!b.departures) { el("span", b.loading ? "…" : "unavailable", "sd-meta", row); return; }
      if (!b.departures.length) { el("span", "no departures", "sd-meta", row); return; }
      for (var i = 0; i < 2; i++) {
        var d = b.departures[i], cell = el("span", "", "sd-dep" + (i ? " sd-later" : ""), row);
        if (!d) continue;
        // Timetable time as on the station board, delay beside it, then the minutes left.
        el("span", d.scheduled, "sd-clock" + (d.cancelled ? " sd-cancelled" : ""), cell);
        var note = d.cancelled ? "×" : d.status ? "!" : d.delay > 0 ? "+" + d.delay : d.trackChanged ? "Pl. " + d.track : "";
        if (note) el("sup", note, "sd-warning", cell);
        if (!d.cancelled && d.minutes < 60) el("span", (b.unreliable ? "≈" : "") + d.minutes + "′", "sd-min", cell);
        cell.title = d.destination + " · " + d.clock + (d.track ? " · Platform " + d.track : "") + (d.status ? " · " + d.status : "");
      }
      var leave = b.leave === null ? "" : b.leave === 0 ? "leave now" : "leave in " + b.leave + "′";
      el("span", leave, "sd-leave" + (b.leave === 0 ? " sd-now" : ""), row);
    });
    if (model.problem !== null) {
      el("div", model.problem === "offline" ? "● Offline · retrying" : "● Updated " + model.problem + " min ago", "sd-health sd-warning", root);
    }
    return root;
  }
});
