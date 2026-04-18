# Mode: submit — Auto-Apply (browser-automated form fill)

The active/automated sibling of `apply`. Evaluates the role if needed, tailors
the CV, opens Chrome, fills every field, uploads the PDF when possible, and
**stops before Submit** for the candidate to review and click.

## Preconditions (run silently before proceeding)

1. `node doctor.mjs` passes (cv.md, profile.yml, portals.yml present).
2. Candidate has a **claude-in-chrome** extension connected. Test with
   `mcp__claude-in-chrome__tabs_context_mcp`. If it fails, tell the candidate:

   > "To use submit mode you need the Claude in Chrome extension.
   > Install: https://claude.com/download (Chrome extension section).
   > Then come back and re-run /career-ops submit."

## Input parsing

`submit` accepts:

- A JD URL — `/career-ops submit https://job-boards.greenhouse.io/...`
- A report ID — `/career-ops submit 001` (uses `reports/001-*.md`)
- Nothing — list top N *Evaluated* rows in `applications.md` and ask the
  candidate which one to submit.

## Workflow

```
1. RESOLVE      → URL + report (fetch/evaluate if missing)
2. TAILOR       → Generate role-specific HTML + PDF
3. OPEN         → New tab, navigate to the application URL
4. CLICK APPLY  → If the form is gated behind an Apply button, click it
5. READ FORM    → Enumerate every input / select / textarea / file upload
6. FILL         → Basic fields from profile.yml; long answers from report
7. PAUSE        → Ask candidate to upload the resume PDF (browsers block JS uploads)
8. VERIFY       → Screenshot; confirm no required fields missed
9. HAND OFF     → Candidate reviews, solves CAPTCHA, clicks Submit
10. POST-APPLY  → Update tracker: Evaluated → Applied, note PDF path
```

## Step 1 — Resolve

Given an input, produce `{ url, reportPath, roleConfigPath }`.

- **If URL given and no matching report:** run `fetch-jd.mjs <url>` to pull the
  JD, then run the `oferta` mode against it to produce a new report. Get
  candidate's go-ahead before running the evaluation if the pipeline is hot
  (to control token spend).
- **If report ID given:** read `reports/{id}-*-*.md`, extract the URL from the
  header, confirm the posting is still live via a quick Ashby/Lever/Greenhouse
  API ping.
- **If nothing given:** `grep 'Evaluated' data/applications.md` and show a
  numbered list ranked by score, then prompt.

## Step 2 — Tailor CV

Check for `config/roles/{slug}.yml`. If missing, generate one from the report:

1. Extract the archetype and proof points from the report's Block B, E, F.
2. Write the role config YAML with the strongest framing first.
3. Show the candidate the generated `summary:` field and ask for green light
   (they will sometimes rewrite the opening line).
4. Run `node tailor-cv.mjs --role config/roles/{slug}.yml`.
5. Run `node generate-pdf.mjs output/{slug}.html output/{slug}.pdf --format=letter`.

## Step 3 — Open and click Apply

```
mcp__claude-in-chrome__tabs_context_mcp          # verify connection
mcp__claude-in-chrome__tabs_create_mcp           # new tab for the application
mcp__claude-in-chrome__navigate(tabId, url)
mcp__claude-in-chrome__find(tabId, "Apply button at top of job posting")
mcp__claude-in-chrome__computer(tabId, "left_click", ref=...)
```

Some Greenhouse boards show the form inline; some gate it behind an Apply
button. `find` + `read_page` tells you which.

## Step 4 — Read the form

```
mcp__claude-in-chrome__read_page(tabId, filter="interactive")
```

Returns refs for every input, combobox, textarea, button. Track them.

## Step 5 — Fill basic fields (parallel where safe)

From `config/profile.yml`:

| Form field | profile.yml source |
|---|---|
| First Name | `candidate.full_name` (split) |
| Last Name | `candidate.full_name` (split) |
| Email | `candidate.email` |
| Phone | `candidate.phone` |
| Country (combobox) | Usually "United States" — check candidate.location |
| LinkedIn | `candidate.linkedin` |
| GitHub | `candidate.github` |
| Twitter/X | `candidate.twitter` |
| Website | `candidate.portfolio_url` |

Use `form_input` for text/textarea. For comboboxes, click the flyout toggle,
screenshot, then `left_click` at the option coordinate.

## Step 6 — Fill long-form answers

Pull from the report's **Block H** (Draft Application Answers). If the report
doesn't have Block H, generate on-the-fly from Block B + profile narrative.

Common fields and fallbacks:

| Field | Source |
|---|---|
| Why this company? / Why this role? | Block H §1 or tailored summary |
| Describe a complex project | Block F top STAR story |
| Salary expectation | profile.yml `compensation.target_range` — flag for candidate review |
| Earliest start date | "Flexible — 2-4 weeks after offer" |
| Reason for leaving current role | Narrative `exit_story` |
| Visa / work authorization | profile.yml `location.visa_status` |
| Pronouns / gender / ethnicity | **NEVER auto-fill demographic questions.** Leave for candidate. |

## Step 7 — File uploads (this is where automation stops)

Browsers block programmatic file uploads for security. When you hit the
Resume / CV "Attach" button:

1. **Stop filling.** Take a screenshot to confirm the current state.
2. Tell the candidate:

   > "Pausing. To upload the resume, click Attach → browse to
   > `<absolute path to the tailored PDF>` → select it.
   > When done, say 'uploaded' and I'll verify the form is clean."

3. If there's a Cover Letter field with an "Enter manually" option, click that
   and paste the cover letter text from Block H — that *can* be automated.

## Step 8 — Verify before submit

Scroll through the whole form via screenshots. Confirm:

- Every required field (red asterisk) has a value
- The uploaded resume filename appears
- CAPTCHA state (Greenhouse usually uses invisible reCAPTCHA v3, but
  sometimes throws an image challenge)

If any required field is missing, tell the candidate which one and how to
complete it. Do NOT guess on demographic / self-identification questions.

## Step 9 — Hand off

Final message pattern:

```
Form is 100% filled except the resume PDF.

Your 2 steps:
1. Upload resume: click Attach under Resume/CV → select
   {absolute PDF path}
2. Solve reCAPTCHA if one appears, then click Submit.

I will NOT click Submit — you do that when you're ready.
```

## Step 10 — Post-submit

If the candidate confirms submission (either by saying so, or the tab title
changes to "Thank you for applying" / URL contains `/confirmation`):

1. Update `data/applications.md`: change status from `Evaluated` to `Applied`.
2. Update the PDF column from ❌ to ✅ if it isn't already.
3. Append a line to the notes: "Applied {YYYY-MM-DD} via direct portal."
4. Suggest next step: `/career-ops contacto` for LinkedIn warm-intro to a
   hiring manager or team member.

## Guardrails (non-negotiable)

- **Never click Submit / Send / Post / Apply-final.** The candidate always
  reviews.
- **Never auto-fill salary if it's a range field.** Show target and minimum
  from profile.yml and let the candidate decide what to enter.
- **Never auto-answer demographic / EEO / self-ID questions.** Always leave
  blank for candidate.
- **Never submit multiple applications in parallel.** One at a time, with
  checkpoints between.
- **Stop at any CAPTCHA, email verification, or SSO redirect.** Hand off.

## Common snags

| Symptom | Fix |
|---|---|
| `read_page` is empty / title-only | The form hasn't opened yet. Click Apply first. |
| Combobox value not sticking via `form_input` | Click toggle flyout → screenshot → left_click at coordinate |
| File input accepts nothing | Browsers block JS uploads. Hand off to candidate. |
| `fetch-jd` returns only the title | The portal isn't Ashby/Greenhouse/Lever. Use WebFetch or ask candidate to paste the JD. |
| reCAPTCHA image challenge | Hand off — automation can't solve and shouldn't try. |

## Output on completion

```
## Submit status: {company} — {role}

Form filled via claude-in-chrome.
- Basic fields: ✓
- Dropdowns: ✓
- Long-form answers: ✓  (source: Block H or generated)
- Cover letter: ✓ (entered manually)
- Resume upload: pending candidate action

Candidate to do:
1. Upload: {absolute PDF path}
2. Solve reCAPTCHA if one appears
3. Click Submit

Tracker: will update Evaluated → Applied on your confirmation.
```
