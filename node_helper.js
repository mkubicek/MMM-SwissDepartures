"use strict";
const NodeHelper = require("node_helper");
const feed = require("./feed");
const departures = require("./departures");

module.exports = NodeHelper.create({
  start: function() { this.boards = new Map(); },
  socketNotificationReceived: function(name, payload) {
    if (name !== "DEPARTURES_FETCH" || !payload || !Array.isArray(payload.boards)) return;
    const self = this;
    payload.boards.slice(0, 3).forEach(function(board, index) {
      if (!/^\d{7}$/.test(board.stop)) return;
      const key = JSON.stringify([board.stop, board.lines, board.via, board.terminals]);
      let state = self.boards.get(key);
      if (!state) {
        if (self.boards.size >= 20) return;
        state = { rows: [], fetchedAt: null, attemptedAt: 0, error: false, pending: null };
        self.boards.set(key, state);
      }
      function send() {
        self.sendSocketNotification("DEPARTURES_DATA", {
          identifier: payload.identifier, index: index,
          rows: state.rows, fetchedAt: state.fetchedAt, error: state.error,
          nextAttemptAt: state.attemptedAt + Math.max(state.error ? 60000 : 0, departures.pollInterval(Date.now()))
        });
      }
      // Share in-flight requests and cached results across connected displays.
      if (state.pending) { state.pending.then(send); return; }
      const interval = Math.max(state.error ? 60000 : 0, departures.pollInterval(Date.now()));
      if (Date.now() - state.attemptedAt < interval) { send(); return; }
      state.attemptedAt = Date.now();
      state.pending = feed.fetchBoard(board).then(function(rows) {
        state.rows = rows; state.fetchedAt = Date.now(); state.error = false;
      }, function(error) {
        state.error = true;
        console.error("[MMM-SwissDepartures] " + board.stop + ": " + error.message);
      }).then(function() { state.pending = null; send(); });
    });
  }
});
