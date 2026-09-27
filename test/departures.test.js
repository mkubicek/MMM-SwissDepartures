const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const d = require('../departures');
const board = { stop: '8503003', lines: ['S7'], via: '8503000' };
function row(extra) {
  return Object.assign({ time: '2026-09-25 08:12:00', line: 'S7', terminal: { id: '8506000', name: 'Winterthur' }, subsequent_stops: [{ id: '8503000' }], dep_delay: '+3' }, extra);
}
function normalize(rows) { return d.normalize({ stop: { id: board.stop }, connections: rows }, board); }
test('Swiss times are independent of host timezone, including winter and midnight', () => {
  assert.equal(d.parseTime('2026-09-25 08:12:00'), Date.parse('2026-09-25T06:12:00Z'));
  assert.equal(d.parseTime('2026-01-25 08:12:00'), Date.parse('2026-01-25T07:12:00Z'));
  assert.equal(d.clock(d.parseTime('2026-09-26 00:01:00')), '00:01');
  assert.ok(Number.isNaN(d.parseTime('2026-03-29 02:30:00')));
});
test('polling changes at exact Zurich boundaries in summer and winter', () => {
  for (const date of ['2026-09-25', '2026-01-25']) {
    for (const [time, interval] of [
      ['00:59:59', 30000], ['01:00:00', 300000], ['05:59:59', 300000],
      ['06:00:00', 30000], ['06:29:59', 30000], ['06:30:00', 15000],
      ['09:29:59', 15000], ['09:30:00', 30000], ['23:59:59', 30000]
    ]) assert.equal(d.pollInterval(d.parseTime(date + ' ' + time)), interval, date + ' ' + time);
  }
});
test('three scheduled boards use 8100 calls per ordinary day', () => {
  const start = Date.parse('2026-09-24T22:00:00Z');
  let calls = 0;
  for (let t = start; t < start + 86400000; t += d.pollInterval(t)) calls += 3;
  assert.equal(calls, 8100);
});
function callsPerDay(stops, start, hours) {
  let calls = 0;
  for (let t = start; t < start + hours * 3600000; t += d.pollInterval(t)) calls += stops;
  return calls;
}
test('the default boards share a stop: two requests per poll, 5400 calls per day', () => {
  let definition;
  vm.runInNewContext(fs.readFileSync(require.resolve('../MMM-SwissDepartures'), 'utf8'), { Module: { register: (name, x) => (definition = x) } });
  const stops = new Set(definition.defaults.boards.map(b => b.stop)).size;
  assert.equal(stops, 2);
  assert.equal(callsPerDay(stops, Date.parse('2026-09-24T22:00:00Z'), 24), 5400);
  // The 25-hour autumn clock-change day repeats one overnight hour: +12 calls per stop.
  assert.equal(callsPerDay(stops, Date.parse('2026-10-24T22:00:00Z'), 25), 5424);
});
test('helper applies morning and overnight limits and cached retry deadlines', async () => {
  let helper, calls = 0, now = d.parseTime('2026-09-25 05:59:00');
  const sent = [];
  vm.runInNewContext(fs.readFileSync(require.resolve('../node_helper'), 'utf8'), {
    require: name => name === 'node_helper' ? { create: x => (helper = x) } : name === './departures' ? d : { fetchBoard: async () => { calls++; return []; } },
    module: {}, console, Date: { now: () => now }, Map
  });
  helper.sendSocketNotification = (name, payload) => sent.push(payload);
  helper.start();
  async function request() {
    helper.socketNotificationReceived('DEPARTURES_FETCH', { identifier: 'a', boards: [board] });
    await new Promise(setImmediate);
  }
  await request();
  now += 30000; await request(); assert.equal(calls, 1);
  assert.equal(sent.at(-1).nextAttemptAt, d.parseTime('2026-09-25 06:04:00'));
  now += 30000; await request(); assert.equal(calls, 2);
  now = d.parseTime('2026-09-25 06:29:45'); await request();
  now += 15000; await request(); assert.equal(calls, 4);
  now += 14000; await request(); assert.equal(calls, 4);
  now += 1000; await request(); assert.equal(calls, 5);
});
test('delayed departures survive scheduled departure and determine walking time', () => {
  const rows = normalize([row()]);
  const now = d.parseTime('2026-09-25 08:13:00');
  assert.equal(d.visible(rows, now, 3).length, 1);
  assert.equal(d.clock(rows[0].expected), '08:15');
  assert.deepEqual(d.timing(rows[0], now, 3), { remaining: 2, leave: -1 });
  assert.equal(d.visible(rows, d.parseTime('2026-09-25 08:16:00'), 3).length, 0);
});
test('missing, zero, negative and nonnumeric delay remain distinct', () => {
  assert.deepEqual([null, undefined, '', '+0', '-1', 'cancelled', '+2x'].map(d.delay), [null, null, null, 0, -1, null, null]);
  assert.equal(normalize([row({ dep_delay: 'cancelled' })])[0].cancelled, true);
  assert.equal(normalize([row({ dep_delay: 'unknown' })])[0].status, 'unknown');
  // search.ch marks cancelled runs with "X".
  assert.equal(normalize([row({ dep_delay: 'X' })])[0].cancelled, true);
  assert.equal(normalize([row({ dep_delay: 'unknown' })])[0].cancelled, false);
});
test('direction filtering precedes limit; platform changes and cancellations survive', () => {
  const rows = normalize([row({ subsequent_stops: [] }), row({ line: 'S6' }), row({ track: '!2', dep_delay: 'cancelled' }), row({ dep_delay: null })]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].track, '2');
  assert.equal(rows[0].trackChanged, true);
  assert.equal(rows[1].delay, null);
  assert.throws(() => d.normalize({ stop: { id: 'wrong' }, connections: [] }, board));
});
test('tram terminal filter excludes opposite direction', () => {
  const rows = d.normalize({ stop: { id: '8576193' }, connections: [row({ line: '11', terminal: { id: '8591067' } }), row({ line: '11', terminal: { id: '8576182' } })] }, { stop: '8576193', lines: ['11'], terminals: ['8591067'] });
  assert.equal(rows.length, 1);
});
test('helper shares in-flight requests, caches results and preserves data on failure', async () => {
  let helper, calls = 0, fail = false, now = d.parseTime('2026-09-25 12:00:00');
  const initialTime = now;
  const sent = [];
  vm.runInNewContext(fs.readFileSync(require.resolve('../node_helper'), 'utf8'), {
    require: name => name === 'node_helper' ? { create: x => (helper = x) } : name === './departures' ? d : { fetchBoard: async () => { calls++; if (fail) throw Error('offline'); return normalize([row()]); } },
    module: {}, console: { error() {} }, Date: { now: () => now }, Map
  });
  helper.sendSocketNotification = (name, payload) => sent.push(payload);
  helper.start();
  const request = id => helper.socketNotificationReceived('DEPARTURES_FETCH', { identifier: id, boards: [board] });
  request('a'); request('b');
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  assert.deepEqual(sent.map(x => x.identifier).sort(), ['a', 'b']);
  request('a'); assert.equal(calls, 1);
  now += 31000; fail = true; request('a');
  await new Promise(setImmediate);
  assert.equal(sent.at(-1).error, true);
  assert.equal(sent.at(-1).fetchedAt, initialTime);
  assert.equal(sent.at(-1).rows.length, 1);
  now += 31000; request('a'); assert.equal(calls, 2);
});

test('summary skips departures you can no longer reach and times the walk to the first catchable one', () => {
  const rows = normalize([
    row({ time: '2026-09-25 08:12:00', dep_delay: '0' }),
    row({ time: '2026-09-25 08:32:00', dep_delay: '+2' }),
    row({ time: '2026-09-25 08:52:00', dep_delay: '0' })
  ]);
  const s = d.summary(rows, d.parseTime('2026-09-25 08:10:00'), 4, 2);
  assert.deepEqual(s.departures.map(x => [x.clock, x.minutes, x.delay]), [['08:34', 24, 2], ['08:52', 42, 0]]);
  assert.equal(s.leave, 20);
  const early = d.summary(rows, d.parseTime('2026-09-25 08:05:00'), 4, 2);
  assert.deepEqual([early.departures[0].clock, early.leave], ['08:12', 3]);
});
test('a cancelled departure stays visible but does not set the walking time', () => {
  const rows = normalize([row({ dep_delay: 'cancelled' }), row({ time: '2026-09-25 08:32:00', dep_delay: '0' })]);
  const s = d.summary(rows, d.parseTime('2026-09-25 08:00:00'), 4, 2);
  assert.deepEqual(s.departures.map(x => x.cancelled), [true, false]);
  assert.equal(s.leave, 28);
});
test('boards on the same stop share one request', async () => {
  const https = require('node:https'), original = https.get;
  let requests = 0;
  https.get = (options, cb) => {
    requests++;
    assert.equal(options.hostname, 'search.ch');
    assert.match(options.path, /stop=8503003&/);
    const { EventEmitter } = require('node:events'), res = new EventEmitter(), req = new EventEmitter();
    res.statusCode = 200; res.headers = {}; res.setEncoding = () => {};
    req.setTimeout = () => {};
    setImmediate(() => { cb(res); res.emit('data', JSON.stringify({ stop: { id: '8503003' }, connections: [row()] })); res.emit('end'); });
    return req;
  };
  try {
    delete require.cache[require.resolve('../feed')];
    const feed = require('../feed');
    const [a, b] = await Promise.all([feed.fetchBoard(board), feed.fetchBoard(Object.assign({}, board, { via: '8503104' }))]);
    assert.equal(requests, 1);
    assert.deepEqual([a.length, b.length], [1, 0]);
  } finally { https.get = original; }
});

test('gzip-encoded boards are decompressed', async () => {
  const https = require('node:https'), zlib = require('node:zlib'), { PassThrough } = require('node:stream'), original = https.get;
  https.get = (options, cb) => {
    assert.equal(options.headers['Accept-Encoding'], 'gzip');
    const { EventEmitter } = require('node:events'), req = new EventEmitter(), res = new PassThrough();
    res.statusCode = 200; res.headers = { 'content-encoding': 'gzip' };
    req.setTimeout = () => {};
    setImmediate(() => { cb(res); res.end(zlib.gzipSync(JSON.stringify({ stop: { id: '8576193' }, connections: [row({ line: '11' })] }))); });
    return req;
  };
  try {
    delete require.cache[require.resolve('../feed')];
    const rows = await require('../feed').fetchBoard({ stop: '8576193', lines: ['11'] });
    assert.deepEqual(rows.map(r => r.line), ['11']);
  } finally { https.get = original; }
});

test('numeric config values and a missing walking time still work', () => {
  const data = { stop: { id: 8576193 }, connections: [row({ line: '11', terminal: { id: 8591067 }, subsequent_stops: [{ id: 8591299 }] })] };
  assert.equal(d.normalize(data, { stop: 8576193, lines: [11], via: 8591299 }).length, 1);
  assert.equal(d.normalize(data, { stop: '8576193', terminals: [8591067] }).length, 1);
  const rows = d.normalize(data, { stop: '8576193' });
  assert.equal(d.summary(rows, d.parseTime('2026-09-25 08:10:00'), undefined, 2).leave, 5); // 08:12 +3 min, no walking time
});
