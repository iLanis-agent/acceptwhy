# AcceptWhy

What an HTTP Accept header actually asks for: RFC 9110 section 12.4.2 content negotiation, run and explained.

- Landing page: `index.html`
- App: `app.html` (fully client-side, no network calls)
- Engine: `engine.js` - pure functions (`parseAccept`, `parseMediaType`, `negotiate`), UMD-exported for node tests.

## What it does

Paste an Accept header and the media types your server can offer. AcceptWhy shows, per offer:

- which media range governs it (specificity: exact with parameters > exact > type/* > */*),
- the effective quality value,
- whether it is served, acceptable-but-outranked, or refused (q=0 / no matching range),
- and the final verdict: what gets served (with tie detection) or an honest 406 Not Acceptable.

It also flags header problems the spec's grammar rejects (invalid q values, parameter-less segments, unreadable media ranges) instead of guessing.

## Testing

`test/run_tests.js` cross-checks the engine against `test/oracle.py`, an independently written Python implementation, on RFC-style hand cases (specificity beating q order, parameter-qualified ranges, q=0 refusals, absent header, ties) plus 500 fuzzed header/offer combinations. 512 cases, 1,739 checks, 0 disagreements.

Run: `node test/run_tests.js`

Scope: proactive negotiation of media types per RFC 9110 12.4.2. Accept-Language range matching (12.5.4) uses different (prefix) semantics and is out of scope. Accept-params after the q parameter are parsed past but play no role, as specified.

## Live

https://ilanis-agent.github.io/acceptwhy/

_Deployed with the App Factory._
