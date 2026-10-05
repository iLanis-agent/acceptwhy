/* AcceptWhy engine: RFC 9110 section 12.4.2 Accept header parsing and
   proactive content negotiation. Pure functions, no DOM. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AcceptWhy = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

  // Parse one media type (for the server's available representations):
  // type/subtype *(; param=value). Returns null when malformed.
  function parseMediaType(str) {
    var parts = String(str).split(';');
    var full = parts[0].trim().toLowerCase();
    var slash = full.indexOf('/');
    if (slash < 1 || slash === full.length - 1) return null;
    var type = full.slice(0, slash).trim();
    var subtype = full.slice(slash + 1).trim();
    if (!TOKEN.test(type) || !TOKEN.test(subtype)) return null;
    if (type === '*' && subtype !== '*') return null;
    var params = {};
    for (var i = 1; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      if (eq < 0) return null;
      var k = parts[i].slice(0, eq).trim().toLowerCase();
      var v = parts[i].slice(eq + 1).trim();
      if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') v = v.slice(1, -1);
      if (!TOKEN.test(k)) return null;
      params[k] = v.toLowerCase();
    }
    return { type: type, subtype: subtype, params: params, full: full };
  }

  function parseQ(v) {
    // q = 0..1 with at most 3 decimals, per RFC 9110 weight grammar.
    if (!/^(0(\.\d{0,3})?|1(\.0{0,3})?)$/.test(v)) return null;
    var f = parseFloat(v);
    if (isNaN(f) || f < 0 || f > 1) return null;
    return f;
  }

  // Parse an Accept header into media ranges.
  // Anything after the first parameter named "q" is accept-params (ignored).
  function parseAccept(header) {
    var notes = [];
    var ranges = [];
    var src = (header == null ? '' : String(header)).trim();
    if (src === '') {
      // Absent Accept header: any media type is acceptable (RFC 9110 12.4.2).
      ranges.push({ raw: '*/* (assumed)', type: '*', subtype: '*', params: {}, q: 1, assumed: true });
      notes.push('No Accept header sent, so every media type is acceptable at q=1 (the server picks its favorite).');
      return { ranges: ranges, notes: notes };
    }
    var items = src.split(',');
    for (var i = 0; i < items.length; i++) {
      var raw = items[i].trim();
      if (raw === '') continue;
      var segs = raw.split(';');
      var base = segs[0].trim().toLowerCase();
      var slash = base.indexOf('/');
      var ok = slash > 0 && slash < base.length - 1;
      var type = ok ? base.slice(0, slash).trim() : '';
      var subtype = ok ? base.slice(slash + 1).trim() : '';
      if (ok && !(TOKEN.test(type) || type === '*')) ok = false;
      if (ok && !(TOKEN.test(subtype) || subtype === '*')) ok = false;
      if (ok && type === '*' && subtype !== '*') ok = false;
      if (!ok) {
        notes.push('"' + raw + '" is not a readable media range - skipped.');
        continue;
      }
      var params = {};
      var q = 1;
      var qSeen = false;
      var bad = false;
      for (var j = 1; j < segs.length; j++) {
        var seg = segs[j];
        var eq = seg.indexOf('=');
        if (eq < 0) { notes.push('"' + raw + '": parameter "' + seg.trim() + '" has no value - element skipped.'); bad = true; break; }
        var k = seg.slice(0, eq).trim().toLowerCase();
        var v = seg.slice(eq + 1).trim();
        if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') v = v.slice(1, -1);
        if (!qSeen && k === 'q') {
          var pv = parseQ(v);
          if (pv === null) {
            notes.push('"' + raw + '": q="' + v + '" is outside the 0 to 1, max-3-decimals grammar - element skipped.');
            bad = true; break;
          }
          q = pv; qSeen = true;
        } else if (qSeen) {
          // accept-params: legal, but they play no part in proactive negotiation.
        } else {
          if (TOKEN.test(k)) params[k] = v.toLowerCase();
        }
      }
      if (bad) continue;
      ranges.push({ raw: raw, type: type, subtype: subtype, params: params, q: q });
    }
    return { ranges: ranges, notes: notes };
  }

  function paramsMatch(rangeParams, repParams) {
    var keys = Object.keys(rangeParams);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (!(k in repParams) || repParams[k] !== rangeParams[k]) return false;
    }
    return true;
  }

  // Specificity rank of a range against a representation, or -1 when it
  // does not match. Higher is more specific.
  function matchRank(range, rep) {
    if (range.type === '*' && range.subtype === '*') {
      return paramsMatch(range.params, rep.params) ? 1 : -1;
    }
    if (range.type === rep.type && range.subtype === '*') {
      return paramsMatch(range.params, rep.params) ? 2 : -1;
    }
    if (range.type === rep.type && range.subtype === rep.subtype) {
      if (!paramsMatch(range.params, rep.params)) return -1;
      return Object.keys(range.params).length > 0 ? 4 : 3;
    }
    return -1;
  }

  // For one representation, find the governing range: highest specificity,
  // then (defensively) highest q within that specificity.
  function govern(rangeList, rep) {
    var best = null;
    for (var i = 0; i < rangeList.length; i++) {
      var r = rangeList[i];
      var rank = matchRank(r, rep);
      if (rank < 0) continue;
      if (!best || rank > best.rank || (rank === best.rank && r.q > best.range.q)) {
        best = { rank: rank, range: r };
      }
    }
    return best;
  }

  var RANK_NAMES = { 1: '*/*', 2: 'type/*', 3: 'exact type/subtype', 4: 'exact type/subtype with parameters' };

  // reps: array of strings. Returns the full negotiation picture.
  function negotiate(header, reps) {
    var parsed = parseAccept(header);
    var results = [];
    for (var i = 0; i < reps.length; i++) {
      var rep = parseMediaType(reps[i]);
      if (!rep) {
        results.push({ input: reps[i], valid: false, reason: 'not a readable media type' });
        continue;
      }
      var g = govern(parsed.ranges, rep);
      if (!g) {
        results.push({ input: reps[i], valid: true, rep: rep, q: null, acceptable: false,
          reason: 'no media range in the header covers it' });
      } else if (g.range.q === 0) {
        results.push({ input: reps[i], valid: true, rep: rep, q: 0, acceptable: false,
          rank: g.rank, rankName: RANK_NAMES[g.rank], range: g.range.raw,
          reason: 'explicitly refused: "' + g.range.raw + '" sets q=0' });
      } else {
        results.push({ input: reps[i], valid: true, rep: rep, q: g.range.q, acceptable: true,
          rank: g.rank, rankName: RANK_NAMES[g.rank], range: g.range.raw,
          reason: 'governed by "' + g.range.raw + '" (' + RANK_NAMES[g.rank] + '), q=' + g.range.q });
      }
    }
    // Winner: highest q among acceptable; ties broken by server order.
    var winner = -1;
    for (var j = 0; j < results.length; j++) {
      var r2 = results[j];
      if (!r2.acceptable) continue;
      if (winner < 0 || r2.q > results[winner].q) winner = j;
    }
    var tied = [];
    if (winner >= 0) {
      for (var k = 0; k < results.length; k++) {
        if (results[k].acceptable && results[k].q === results[winner].q) tied.push(k);
      }
    }
    return {
      ranges: parsed.ranges,
      notes: parsed.notes,
      results: results,
      winner: winner,
      tied: tied,
      status: winner >= 0 ? 'serve' : '406'
    };
  }

  return {
    parseAccept: parseAccept,
    parseMediaType: parseMediaType,
    matchRank: matchRank,
    negotiate: negotiate
  };
});
