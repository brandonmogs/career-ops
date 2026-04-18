#!/usr/bin/env node
/**
 * fetch-jd.mjs — Zero-LLM JD fetcher for Greenhouse / Ashby / Lever.
 *
 * Client-side JavaScript on Ashby + Lever means WebFetch only returns the
 * title. This script hits their public JSON APIs directly, strips HTML,
 * and writes a clean JD markdown file per URL.
 *
 * Usage:
 *   node fetch-jd.mjs <url1> [url2] ...
 *   node fetch-jd.mjs --pipeline          # fetch all unchecked URLs in data/pipeline.md
 *   node fetch-jd.mjs --from reports/001-vercel-2026-04-18.md  # extract URL from a report
 *
 * Output: jds/{company}-{role-slug}.md (one per URL)
 *
 * Zero Claude API tokens.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const OUT_DIR = resolve(ROOT, 'jds');
const PIPELINE = resolve(ROOT, 'data/pipeline.md');

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

/** Turn an Ashby / Greenhouse / Lever job URL into { kind, org, id, apiUrl }. */
function classify(url) {
  let m;

  m = url.match(/^https?:\/\/jobs\.ashbyhq\.com\/([^/?#]+)\/([^/?#]+)/i);
  if (m) return { kind: 'ashby', org: m[1], id: m[2], apiUrl: `https://api.ashbyhq.com/posting-api/job-board/${m[1]}?includeCompensation=true` };

  m = url.match(/^https?:\/\/job-boards\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i);
  if (m) return { kind: 'greenhouse', org: m[1], id: m[2], apiUrl: `https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs/${m[2]}?content=true` };

  m = url.match(/^https?:\/\/boards\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i);
  if (m) return { kind: 'greenhouse', org: m[1], id: m[2], apiUrl: `https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs/${m[2]}?content=true` };

  m = url.match(/^https?:\/\/jobs\.lever\.co\/([^/?#]+)\/([^/?#]+)/i);
  if (m) return { kind: 'lever', org: m[1], id: m[2], apiUrl: `https://api.lever.co/v0/postings/${m[1]}/${m[2]}?mode=json` };

  return null;
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function slugify(s) {
  return String(s || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'career-ops/fetch-jd' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function fetchAshby({ org, id }) {
  const data = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${org}?includeCompensation=true`);
  const jobs = data.jobs || [];
  const job = jobs.find(j => j.id === id);
  if (!job) throw new Error(`Ashby ${org}: job id ${id} not found (${jobs.length} jobs)`);
  const desc = stripHtml(job.descriptionHtml || job.descriptionPlain || '');
  return {
    title: job.title,
    company: org,
    location: job.locationName || '',
    team: job.teamName || '',
    employment: job.employmentType || '',
    compensation: job.compensation?.compensationTierSummary || '',
    published: job.publishedAt || '',
    url: job.jobUrl || '',
    body: desc,
  };
}

async function fetchGreenhouse({ org, id }) {
  const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${org}/jobs/${id}?content=true`);
  const desc = stripHtml(data.content || '');
  return {
    title: data.title,
    company: data.company_name || org,
    location: data.location?.name || '',
    team: data.departments?.map(d => d.name).join(', ') || '',
    employment: '',
    compensation: data.metadata?.find(m => /salary|comp/i.test(m.name || ''))?.value || '',
    published: data.updated_at || '',
    url: data.absolute_url || '',
    body: desc,
  };
}

async function fetchLever({ org, id }) {
  const data = await fetchJson(`https://api.lever.co/v0/postings/${org}/${id}?mode=json`);
  let desc = stripHtml(data.descriptionPlain || data.description || '');
  if (Array.isArray(data.lists)) {
    for (const l of data.lists) desc += `\n\n## ${l.text}\n${stripHtml(l.content)}`;
  }
  if (data.additional) desc += `\n\n${stripHtml(data.additional)}`;
  return {
    title: data.text,
    company: org,
    location: data.categories?.location || '',
    team: data.categories?.team || '',
    employment: data.categories?.commitment || '',
    compensation: data.salaryRange ? JSON.stringify(data.salaryRange) : '',
    published: data.createdAt ? new Date(data.createdAt).toISOString() : '',
    url: data.hostedUrl || '',
    body: desc,
  };
}

async function fetchOne(url) {
  const cls = classify(url);
  if (!cls) return { url, error: 'unsupported portal (use Greenhouse, Ashby, or Lever)' };
  try {
    let job;
    if (cls.kind === 'ashby') job = await fetchAshby(cls);
    else if (cls.kind === 'greenhouse') job = await fetchGreenhouse(cls);
    else if (cls.kind === 'lever') job = await fetchLever(cls);
    else return { url, error: `unknown kind ${cls.kind}` };

    const slug = `${slugify(job.company)}-${slugify(job.title)}`;
    const file = resolve(OUT_DIR, `${slug}.md`);
    const content = `TITLE: ${job.title}
COMPANY: ${job.company}
LOCATION: ${job.location}
TEAM: ${job.team}
EMPLOYMENT: ${job.employment}
URL: ${job.url}
COMPENSATION: ${job.compensation}
PUBLISHED: ${job.published}

---JD---
${job.body}
`;
    writeFileSync(file, content);
    return { url, file, title: job.title, company: job.company, bytes: content.length };
  } catch (err) {
    return { url, error: err.message };
  }
}

function urlsFromPipeline() {
  if (!existsSync(PIPELINE)) return [];
  const text = readFileSync(PIPELINE, 'utf-8');
  const urls = [];
  for (const m of text.matchAll(/^- \[ \] (https?:\/\/\S+)/gm)) urls.push(m[1]);
  return urls;
}

function urlFromReport(path) {
  const text = readFileSync(resolve(ROOT, path), 'utf-8');
  const m = text.match(/\*\*URL:\*\*\s*(https?:\/\/\S+)/);
  if (!m) throw new Error(`no URL found in ${path}`);
  return m[1];
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node fetch-jd.mjs <url...>');
    console.error('       node fetch-jd.mjs --pipeline');
    console.error('       node fetch-jd.mjs --from <report-path>');
    process.exit(1);
  }

  let urls = [];
  if (args[0] === '--pipeline') urls = urlsFromPipeline();
  else if (args[0] === '--from') urls = [urlFromReport(args[1])];
  else urls = args;

  if (urls.length === 0) {
    console.error('No URLs to fetch.');
    process.exit(1);
  }

  console.log(`Fetching ${urls.length} JD${urls.length === 1 ? '' : 's'}...`);
  const results = await Promise.all(urls.map(fetchOne));
  let ok = 0, fail = 0;
  for (const r of results) {
    if (r.error) { console.log(`  X ${r.url}\n     ${r.error}`); fail++; }
    else { console.log(`  + ${r.company} | ${r.title}\n     ${r.file} (${r.bytes} bytes)`); ok++; }
  }
  console.log(`\n${ok} ok, ${fail} failed.`);
  if (fail > 0) process.exit(2);
}

main().catch(err => { console.error('fetch-jd.mjs failed:', err); process.exit(1); });
