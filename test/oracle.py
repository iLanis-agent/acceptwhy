"""Independent RFC 9110 Accept negotiation reference, for cross-checking engine.js."""
import json, sys, re

TOKEN = re.compile(r"^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$")

def parse_q(v):
    if not re.match(r"^(0(\.\d{0,3})?|1(\.0{0,3})?)$", v):
        return None
    f = float(v)
    return f if 0.0 <= f <= 1.0 else None

def parse_accept(h):
    h = (h or "").strip()
    if not h:
        return [{"type": "*", "subtype": "*", "params": {}, "q": 1.0}]
    out = []
    for item in h.split(","):
        item = item.strip()
        if not item:
            continue
        segs = item.split(";")
        base = segs[0].strip().lower()
        if base.count("/") != 1:
            continue
        t, s = (x.strip() for x in base.split("/"))
        if not (TOKEN.match(t) or t == "*") or not (TOKEN.match(s) or s == "*"):
            continue
        if t == "*" and s != "*":
            continue
        params, q, qseen, bad = {}, 1.0, False, False
        for seg in segs[1:]:
            if "=" not in seg:
                bad = True
                break
            k, v = (x.strip() for x in seg.split("=", 1))
            if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
                v = v[1:-1]
            k = k.lower()
            if not qseen and k == "q":
                pv = parse_q(v)
                if pv is None:
                    bad = True
                    break
                q, qseen = pv, True
            elif not qseen:
                if TOKEN.match(k):
                    params[k] = v.lower()
        if bad:
            continue
        out.append({"type": t, "subtype": s, "params": params, "q": q})
    return out

def parse_media(str_):
    segs = str_.split(";")
    full = segs[0].strip().lower()
    if full.count("/") != 1:
        return None
    t, s = (x.strip() for x in full.split("/"))
    if not TOKEN.match(t) or not TOKEN.match(s) or (t == "*" and s != "*"):
        return None
    params = {}
    for seg in segs[1:]:
        if "=" not in seg:
            return None
        k, v = (x.strip() for x in seg.split("=", 1))
        if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
            v = v[1:-1]
        k = k.lower()
        if not TOKEN.match(k):
            return None
        params[k] = v.lower()
    return {"type": t, "subtype": s, "params": params}

def pmatch(rp, pp):
    return all(k in pp and pp[k] == v for k, v in rp.items())

def rank(r, p):
    if r["type"] == "*" and r["subtype"] == "*":
        return 1 if pmatch(r["params"], p["params"]) else -1
    if r["type"] == p["type"] and r["subtype"] == "*":
        return 2 if pmatch(r["params"], p["params"]) else -1
    if r["type"] == p["type"] and r["subtype"] == p["subtype"]:
        if not pmatch(r["params"], p["params"]):
            return -1
        return 4 if r["params"] else 3
    return -1

def negotiate(header, reps):
    ranges = parse_accept(header)
    results = []
    for rep_s in reps:
        rep = parse_media(rep_s)
        if rep is None:
            results.append(None)
            continue
        best = None
        for r in ranges:
            rk = rank(r, rep)
            if rk < 0:
                continue
            if best is None or rk > best[0] or (rk == best[0] and r["q"] > best[1]["q"]):
                best = (rk, r)
        if best is None:
            results.append((False, None))
        elif best[1]["q"] == 0.0:
            results.append((False, 0.0))
        else:
            results.append((True, best[1]["q"]))
    winner = -1
    for i, res in enumerate(results):
        if res and res[0]:
            if winner < 0 or res[1] > results[winner][1]:
                winner = i
    return {"results": results, "winner": winner}

cases = json.load(sys.stdin)
print(json.dumps([negotiate(c["header"], c["reps"]) for c in cases]))
