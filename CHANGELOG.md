# Changelog

## 1.0.0 — first public release

- One compact line per direction: line, label, the next two departures you can still catch
  (timetable time with delay marker, minutes left) and "leave in N′" from your walking time.
- Direction chosen by a subsequent stop (`via`), a terminal (`terminals`) and/or `lines`.
- Boards on the same stop share one search.ch request; displays share cached results.
- Swiss-time poll schedule: 15 s in the morning peak, 30 s by day, 5 min overnight
  (2,700 requests per stop per day), with a 60 s back-off after failures.
- Redraws only when something visible changes; stale/offline health line and `≈` minutes
  when data can no longer be trusted.
- search.ch's `X` delay marker is treated as a cancellation (struck-through, never used
  for walking advice).
- Public example defaults (Zürich Stadelhofen S7, Zürich Bellevue tram 11), demo with
  synthetic departures, Node 10 / Chrome 96 runtime compatibility check and CI.
