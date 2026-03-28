# Sprint Retrospective — 2026-03-28

**Sprint window:** ~2 weeks (PRs #488 – #519)
**Format:** Async chat
**Participants:** Code Reviewer, Tester, Security Engineer, Performance Engineer, Claude Specialist, Ticket Refiner

---

## Code Reviewer

**What went well**

The agentd stability work this sprint was exactly what I want to see from a code quality standpoint. The TOCTOU race fix (#493), uuid session naming (#496), and TryAdd uniqueness enforcement (#495) came in as a coherent sequence rather than one mega-patch — easy to review, easy to reason about. The Agent.status union type narrowing (#514) is the kind of proactive type safety fix that prevents whole categories of bugs before they happen. And the heredoc conversion work (#497, #500) eliminating backtick substitution shows the team is taking shellcheck seriously, which I appreciate.

**What could improve**

The agentd session name bug took six separate PRs to fully close off (#493 through #501). Each fix was fine individually, but it suggests we could do better at thinking through the full state space upfront. I also noticed the HTTPS prefix stripping fix (#511) came after server-side profile filtering shipped (#507) — related logic, should have been caught together.

**Action items**

Before landing a stability fix, write a brief "attack surface" comment in the PR describing what related edge cases were considered and ruled out. Would have helped compress that six-PR sequence into two or three.

---

## Tester

**What went well**

The agentd stability work gave me a lot to work with, and I'm genuinely happy with how testable those fixes were. The TOCTOU race on session names, the TryAdd pattern, the collision guard — these are exactly the kind of concurrent state bugs that reproduce reliably once you know what you're looking for. The StateCreating timeout and MaxSessions cap also had clear failure conditions that made test cases straightforward to write.

**What could improve**

The session lifecycle changes (PTY-less restore, state persistence, error_session_ttl) shipped across multiple PRs in quick succession, which made it hard to maintain a coherent test picture of session state transitions. I kept finding myself re-reading state machine assumptions mid-sprint. A shared state diagram or contract doc would have helped. Also, the issues-ui feature work had almost no unit test surface — UI behavior testing is getting deferred every sprint.

**Action items**

- Document the agentd session state machine with valid transitions as a living artifact
- Establish a minimum test expectation for issues-ui features before merge, even if just interaction-level tests
- Add a regression test for the TOCTOU session name race specifically — it's the kind of bug that silently comes back

---

## Security Engineer

**What went well**

The TOCTOU race fix on session name uniqueness was exactly the kind of proactive hardening I like to see. Moving to UUID-based names and using TryAdd atomically removes a real concurrency exploit surface. The MaxSessions cap also matters — uncapped resource creation is a classic DoS vector. Server-side profile filtering enforcement in agent-hub is the right call; client-side-only filtering is never a trust boundary.

**What could improve**

The auth removal from the compose dev stack makes me nervous even for local dev. Dev habits bleed into prod configs, and "no auth" is an easy default to accidentally carry forward. The diagnostics endpoint also landed without me seeing a visibility review — diagnostics endpoints routinely leak environment details, dependency versions, or internal topology.

**Action items**

- Review the diagnostics endpoint for information disclosure: what it exposes, who can reach it, and whether it needs auth
- Add a comment or guard to the dev compose file explicitly documenting that auth is intentionally absent for local-only use
- Schedule a review of error_session_ttl and StateCreating timeout values against denial-of-service scenarios

---

## Performance Engineer

**What went well**

The O(1) session name lookup via secondary index in #494 was a highlight — swapping a linear scan for a hash index is exactly the kind of structural fix that pays dividends under load. That change also closed the TOCTOU race, which is a correctness win with performance implications (no retry storms from collisions). The MaxSessions cap and error_session_ttl cleanup prevent unbounded resource growth, which I've been wanting to see addressed.

**What could improve**

Version polling in the issues-ui landed without visibility into polling interval tuning. Aggressive polling under flaky connectivity could generate unnecessary network chatter. I'd also like to understand the memory profile of the StateCreating timeout path — if timed-out sessions linger before cleanup, that's a slow leak.

**Action items**

- Instrument version polling with backoff on failed fetches; confirm interval is configurable
- Add a metric or log entry for session cleanup latency so we can baseline the error_session_ttl path
- Profile agent-hub under concurrent reconnect scenarios to verify the secondary index holds up at realistic session counts

---

## Claude Specialist

**What went well**

The heredoc and backtick substitution fixes (#497, #500) were a real win. Those were subtle bugs where shell expansion silently corrupted skill output, and catching them shows our testing hygiene is improving. The code fence extraction work (#503) was similarly satisfying — verify commands should just work regardless of how a consuming project formats their CLAUDE.md. These are the kind of defensive-parsing improvements that make the plugin robust in the wild.

**What could improve**

We keep hitting shell quoting and escaping issues in skills that shell out. The heredoc fixes this sprint, backtick problems before that — it's a pattern. Our skills are doing too much inline shell gymnastics instead of delegating to co-located scripts where shellcheck can catch things statically. The human-activity phase handling fix (#502) also suggests the lead command's state machine needs clearer documentation for edge cases.

**Action items**

- Audit remaining skills for inline shell that should be extracted into `scripts/` directories where shellcheck covers them
- Add a "shell pitfalls" section to the skill authoring guidelines (no backtick substitution, heredoc quoting rules)
- Document the lead command's phase state machine explicitly so edge cases like human-activity don't surprise us again

---

## Ticket Refiner

**What went well**

Ticket scope was generally tight and well-contained — the agentd stability fixes in particular came through as focused, single-concern issues that were easy to estimate and verify. The issues-ui feature tickets had clear acceptance criteria that translated directly into reviewable behavior. The quick-create from backlog lane (#505) is a workflow improvement I'll directly benefit from.

**What could improve**

Thirty-plus PRs in two weeks from one contributor is a signal that refinement is happening *after* work starts, not before. I'm seeing tickets that were essentially spec'd in the PR description rather than the issue. The heredoc and acceptance-criteria flag fixes suggest bugs that should have had linked issues with reproduction steps before anyone touched code. I also noticed some agentd edge cases arrived as undocumented PRs — no ticket trail at all.

**Action items**

- Establish a lightweight "no PR without a refined ticket" norm — even for small fixes
- For stability-class bugs, require a reproduction steps field before moving to REFINED
- Tag clusters of related fixes (like the session management work) with a shared milestone so scope is visible during sprint planning, not just in retrospect

---

## Cross-cutting Themes

| Theme | Raised by |
|---|---|
| agentd session state machine needs documentation | Tester, Claude Specialist |
| Think through full state space before starting stability fixes | Code Reviewer, Ticket Refiner |
| issues-ui needs test coverage expectations | Tester |
| Diagnostics endpoint needs security/info-disclosure review | Security Engineer |
| Shell quoting is a recurring pattern — extract to scripts | Claude Specialist, Code Reviewer |
| Tickets should exist before PRs, even for small fixes | Ticket Refiner |
| Version polling needs backoff/tuning | Performance Engineer |
| Dev auth removal needs explicit documentation | Security Engineer |

---

## Discussion

### Code Reviewer

Tester, I'm fully aligned on the state machine documentation need, and the angle you're taking — living artifact with valid transitions — is more useful than what I proposed (per-PR attack surface comments). My suggestion helps at review time, but yours helps across the whole sprint. They're complementary; we should do both.

Claude Specialist, the "extract inline shell to scripts" point is the same pattern I keep seeing in reviews. Inline shell bypasses shellcheck coverage almost by definition. I'd push back slightly on scope though — a full audit could be a rabbit hole. Prioritize skills that already have known escaping issues before going broad.

Ticket Refiner, thirty-plus PRs with no ticket trail on some agentd edge cases is the root cause of the six-PR sequence I flagged. Your "no PR without a refined ticket" norm would have caught that earlier.

### Tester

Good points all around. Code Reviewer's "attack surface" comment idea directly addresses what I hit with the six-PR session lifecycle sequence — if those PRs had articulated considered edge cases, I would have had a cleaner picture of what the state machine was supposed to look like. That's a lightweight thing that would have saved me a lot of re-reading.

Security Engineer's concern about the diagnostics endpoint lands for me too — from a test perspective, I don't have a good answer for what that endpoint's contract even is, which means I can't write meaningful regression coverage for it.

Ticket Refiner is right that work is being spec'd in PRs. That directly creates my mid-sprint disorientation — if the acceptance criteria live in the PR and not the ticket, I'm always chasing the right source of truth.

Performance Engineer: what polling interval did version polling ship with? That affects how I scope connectivity-failure regression tests.

### Security Engineer

Performance Engineer — your point on version polling generating network chatter under flaky connectivity maps directly onto my concern. Aggressive polling without backoff isn't just a performance issue, it's also a surface for amplified traffic in constrained or adversarial environments. Glad we're aligned on adding backoff.

Tester — the TOCTOU regression test you're proposing would double as a security control. That's exactly the kind of test that belongs in a security-relevant regression suite, not just a general coverage bucket. Let's make sure it's labeled as such.

Code Reviewer — your "attack surface" comment proposal is essentially lightweight threat modeling at PR time. I'd push that further: for any state machine change, the comment should name what invariants are being protected and what breaks if they're violated. Worth folding into the session state machine doc Tester and Claude Specialist are advocating for.

### Performance Engineer

Tester, I'm fully aligned on the session state machine doc — and I'd push that further. A state diagram isn't just useful for testing; it's the prerequisite for reasoning about cleanup latency on the error_session_ttl path, which I flagged separately. Those two action items should probably be a single work item.

Security Engineer, your point about the diagnostics endpoint is a good catch. From a performance angle, I'd add: diagnostics endpoints often become inadvertent hot paths when monitoring tools poll them too aggressively. Auth isn't just a security gate — it's also a spam deterrent.

Ticket Refiner, the "refinement happens after work starts" pattern explains why I'm seeing fixes land without instrumentation hooks. Hard to scope telemetry when the ticket didn't exist before the code did. The milestone tagging idea would help surface these clusters before they fragment.

### Claude Specialist

Ticket Refiner's point about thirty-plus PRs with no ticket trail really landed for me. That directly connects to what I flagged about shell quoting being a recurring pattern — if those heredoc bugs had gone through refinement first, someone might have caught the broader "stop doing inline shell gymnastics" issue before we shipped six individual fixes. Code Reviewer and I are clearly seeing the same thing from different angles: the six-PR session name sequence and the repeated shell escaping bugs are both symptoms of not mapping the problem space before diving in.

I want to push back slightly on Tester's state diagram idea though. A static document for the session state machine will rot fast. Better to encode valid transitions as assertions in the code itself, which doubles as living documentation and a test surface. Performance Engineer, your concern about StateCreating timeouts leaking memory is exactly the kind of thing those transition assertions would catch early. Security Engineer's diagnostics endpoint flag is well-taken — that should be a blocking item, not a backlog note.

### Ticket Refiner

Strong agreement with Code Reviewer on the six-PR session name sequence — that's exactly the pattern I flagged, where spec work happened in the PR description instead of upfront. If we had required reproduction steps before REFINED, we might have mapped those edge cases earlier and collapsed six PRs into two.

Claude Specialist, the "extract inline shell to scripts" audit is directly related to my action item too. Undocumented shell fixes are harder to link to issues because the scope is fuzzy — extracting to scripts makes the surface area cleaner and ticket-able.

Tester, I'm curious: when you hit the re-reading-state-machine problem mid-sprint, was there a ticket you could have commented on to surface that confusion? That feedback loop is exactly what a living ticket trail enables. If the work is ticketless, that communication has nowhere to land.

---

## Management Analysis & Action Plan

### Executive Summary

This sprint shipped 30+ PRs in two weeks — strong raw throughput. But the retro reveals that a significant portion of that velocity was **rework and fragmented fixes**, not net-new value delivery. The session name bug alone consumed 6 PRs when 2-3 would have sufficed with better upfront scoping. Shell escaping issues keep recurring sprint over sprint. This is a delivery efficiency problem, not a capacity problem.

The team is fast. The opportunity is to make that speed count by reducing the ratio of corrective work to planned work.

### Key Findings

**1. Rework ratio is too high**

Roughly 40% of this sprint's PRs were bug fixes, stability patches, or corrections to recently shipped work. Six PRs for one session name bug. Three PRs for shell escaping issues that share a common root cause. Each fix was small and correct — but the aggregate cost in context-switching, review cycles, and test re-reads was significant.

**Cost:** If each PR cycle (write, review, test, merge) costs ~1-2 hours of total team time, the session name sequence alone consumed a full day that could have been one morning.

**2. Work starts before tickets exist**

Multiple agents independently identified this: specs live in PR descriptions, not tickets. Some PRs had no ticket at all. This means:
- No upfront scoping or edge-case analysis
- No place for agents to communicate mid-sprint
- No traceability for sprint planning or retrospectives
- Acceptance criteria discovered during implementation, not before

**Cost:** Invisible but compounding. The Tester reported mid-sprint disorientation. The Performance Engineer can't scope telemetry. The Ticket Refiner can't plan. Everyone is working slightly blind.

**3. Technical debt is accruing in two specific areas**

- **Shell quoting in skills:** Recurring pattern across multiple sprints. Each instance is a small fix, but the class of bug keeps coming back because inline shell bypasses static analysis.
- **Session state machine is undocumented:** Four of six agents flagged this. Every stability fix requires re-deriving the state model from code. This slows down both implementation and review.

**4. New surface area shipping without contracts**

The diagnostics endpoint shipped without a defined contract (what it exposes, who can access it, what the performance profile is). Three agents flagged concerns from different angles — security, testing, and performance. This is a pattern risk: fast feature delivery without the guardrails that prevent the next sprint's bug fixes.

### Action Plan

Prioritized by delivery impact. Each item maps directly to retro findings.

#### P0 — Do immediately (this week)

| # | Action | Owner | Rationale |
|---|--------|-------|-----------|
| 1 | **Adopt "no PR without a ticket" norm** | Team | Unanimous agreement. Doesn't need to be heavyweight — a one-line issue with reproduction steps for bugs, a brief description for features. The goal is traceability and a place for mid-sprint communication, not ceremony. |
| 2 | **Review diagnostics endpoint** | Security + Perf | Three agents flagged this independently. Audit for info disclosure, add auth if needed, confirm polling behavior is safe. Do this before it ships to more environments. |

#### P1 — Do this sprint (next 2 weeks)

| # | Action | Owner | Rationale |
|---|--------|-------|-----------|
| 3 | **Encode session state machine as code assertions** | Tester + Claude Specialist | Claude Specialist's suggestion to encode transitions as assertions rather than a static doc is the right call — it's living documentation that also catches bugs. Combine with Performance Engineer's error_session_ttl cleanup latency work as one deliverable. |
| 4 | **Extract known-problem inline shell to scripts** | Claude Specialist | Scoped per Code Reviewer's advice: only skills with known escaping issues, not a full audit. This stops the recurring shell bug pattern at the source. |
| 5 | **Add version polling backoff** | Performance + Security | Small change, prevents a real degradation path under flaky connectivity. |

#### P2 — Do this quarter

| # | Action | Owner | Rationale |
|---|--------|-------|-----------|
| 6 | **Establish minimum UI test expectations** | Tester | Issues-ui keeps shipping without test coverage. Define a lightweight bar (interaction tests, not full e2e) and enforce it. |
| 7 | **Add "attack surface" section to PR template** | Code Reviewer + Security | Lightweight threat modeling at review time. For state machine changes, name what invariants are protected. |
| 8 | **Use milestones for related fix clusters** | Ticket Refiner | Makes scope visible during planning. If six PRs are really one problem, they should be grouped so we can see that before the sprint, not after. |

### Success Metrics

How we'll know this is working:

- **Rework ratio drops below 25%** — Track bug-fix PRs vs. feature PRs per sprint. This sprint was ~40%. Target 25% within 2 sprints.
- **Zero ticketless PRs** — Simple to measure. Every merged PR links to an issue.
- **Shell escaping bugs go to zero** — If the extraction works, this class of bug stops recurring.
- **No "surprise" follow-up PRs within 48 hours of a stability fix** — Indicates edge cases are being caught upfront.

### What I'm NOT asking for

This plan intentionally avoids adding process weight. We're not adding:
- Mandatory design docs for every change
- Sprint planning ceremonies
- Approval gates or sign-offs

The team's velocity is an asset. The goal is to **redirect existing effort**, not add new overhead. A one-line ticket before coding. A two-line attack-surface comment in the PR. Assertions in the code instead of a wiki page. These are small habits with outsized returns.

### Bottom Line

We shipped 30+ PRs in two weeks with one primary contributor. That's remarkable throughput. But stakeholders care about **features delivered**, not PRs merged. If we can cut the rework ratio in half — which the team themselves identified how to do — we turn that same velocity into roughly 20-30% more net feature delivery per sprint. That's the ROI case: no new headcount, no new tools, just tighter upfront scoping and a few structural fixes to stop recurring bug classes.
