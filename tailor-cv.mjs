#!/usr/bin/env node
/**
 * tailor-cv.mjs — Role-tailored CV HTML generator.
 *
 * Reads:
 *   - templates/cv-template.html         (the layout)
 *   - config/profile.yml                 (candidate fundamentals)
 *   - cv.md OR a role config .yml        (content)
 *
 * Writes:
 *   - output/{name-slug}-{role-slug}.html
 *
 * Usage:
 *   node tailor-cv.mjs                                    # default generic CV from cv.md
 *   node tailor-cv.mjs --role path/to/role-config.yml     # tailored CV from role config
 *   node tailor-cv.mjs --role path/to/role-config.yml --out output/custom.html
 *
 * See templates/role-config.example.yml for the role-config format.
 *
 * After generating HTML, run:
 *   node generate-pdf.mjs output/{slug}.html output/{slug}.pdf --format=letter
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const TEMPLATE_PATH = resolve(ROOT, 'templates/cv-template.html');
const PROFILE_PATH = resolve(ROOT, 'config/profile.yml');
const CV_PATH = resolve(ROOT, 'cv.md');
const OUT_DIR = resolve(ROOT, 'output');

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

function slugify(s) {
  return String(s || 'cv').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function esc(s) { return String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// HTML builders for each section
const tags = list => (list || []).map(t => `<span class="competency-tag">${esc(t)}</span>`).join('\n      ');

const job = ({ company, role, period, location, bullets }) => `<div class="job">
    <div class="job-header">
      <span class="job-company">${esc(company)}</span>
      <span class="job-period">${esc(period || '')}</span>
    </div>
    <div class="job-role">${esc(role || '')}${location ? ` &middot; <span class="job-location">${esc(location)}</span>` : ''}</div>
    <ul>
      ${(bullets || []).map(b => `<li>${b}</li>`).join('\n      ')}
    </ul>
  </div>`;

const project = ({ title, badge, desc, tech }) => `<div class="project">
    <span class="project-title">${esc(title)}</span>${badge ? `<span class="project-badge">${esc(badge)}</span>` : ''}
    <div class="project-desc">${desc || ''}</div>
    ${tech ? `<div class="project-tech">${esc(tech)}</div>` : ''}
  </div>`;

const edu = ({ title, org, year, desc }) => `<div class="edu-item">
    <div class="edu-header">
      <span class="edu-title">${esc(title)} &middot; <span class="edu-org">${esc(org)}</span></span>
      <span class="edu-year">${esc(year || '')}</span>
    </div>
    ${desc ? `<div class="edu-desc">${esc(desc)}</div>` : ''}
  </div>`;

const cert = ({ title, org, year }) => `<div class="cert-item">
    <span class="cert-title">${esc(title)} &middot; <span class="cert-org">${esc(org)}</span></span>
    <span class="cert-year">${esc(year || '')}</span>
  </div>`;

const skills = groups => `<div class="skills-grid">
    ${(groups || []).map(g => `<div class="skill-item"><span class="skill-category">${esc(g.label)}:</span> ${g.items}</div>`).join('\n    ')}
  </div>`;

function render(template, data) {
  let out = template;
  for (const [key, value] of Object.entries(data)) out = out.replaceAll(`{{${key}}}`, value ?? '');
  return out;
}

/** Turn profile.yml into COMMON placeholder values. */
function commonFromProfile(profile) {
  const c = profile.candidate || {};
  return {
    LANG: 'en',
    PAGE_WIDTH: '8.5in',
    NAME: c.full_name || 'Candidate',
    EMAIL: c.email || '',
    LINKEDIN_URL: c.linkedin || '',
    LINKEDIN_DISPLAY: (c.linkedin || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''),
    PORTFOLIO_URL: c.portfolio_url || '',
    PORTFOLIO_DISPLAY: (c.portfolio_url || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''),
    LOCATION: c.location || '',
    SECTION_SUMMARY: 'Summary',
    SECTION_COMPETENCIES: 'Core Competencies',
    SECTION_EXPERIENCE: 'Experience',
    SECTION_PROJECTS: 'Selected Projects',
    SECTION_EDUCATION: 'Education',
    SECTION_CERTIFICATIONS: 'Credentials',
    SECTION_SKILLS: 'Technical Skills',
  };
}

/** Generic CV from cv.md — simple plain-text render so we never break doctor. */
function genericFromCvMd() {
  const cv = existsSync(CV_PATH) ? readFileSync(CV_PATH, 'utf-8') : '';
  return {
    SUMMARY_TEXT: 'See cv.md for canonical content. Use `--role <config.yml>` to produce a role-tailored CV.',
    COMPETENCIES: tags([]),
    EXPERIENCE: `<div class="job"><div class="job-role"><pre style="white-space:pre-wrap">${esc(cv)}</pre></div></div>`,
    PROJECTS: '',
    EDUCATION: '',
    CERTIFICATIONS: '',
    SKILLS: skills([]),
  };
}

/** Role-config version — full control via YAML. */
function fromRoleConfig(cfg) {
  return {
    SUMMARY_TEXT: cfg.summary || '',
    COMPETENCIES: tags(cfg.competencies),
    EXPERIENCE: (cfg.experience || []).map(job).join('\n'),
    PROJECTS: (cfg.projects || []).map(project).join('\n'),
    EDUCATION: (cfg.education || []).map(edu).join('\n'),
    CERTIFICATIONS: (cfg.credentials || []).map(cert).join('\n'),
    SKILLS: skills(cfg.skills),
  };
}

function main() {
  const args = process.argv.slice(2);
  let rolePath = null, outPath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--role') rolePath = args[++i];
    else if (args[i] === '--out') outPath = args[++i];
  }

  if (!existsSync(TEMPLATE_PATH)) { console.error(`Missing ${TEMPLATE_PATH}`); process.exit(1); }
  if (!existsSync(PROFILE_PATH)) { console.error(`Missing ${PROFILE_PATH} — run: cp config/profile.example.yml config/profile.yml`); process.exit(1); }

  const template = readFileSync(TEMPLATE_PATH, 'utf-8');
  const profile = yaml.load(readFileSync(PROFILE_PATH, 'utf-8')) || {};
  const common = commonFromProfile(profile);

  let content, slug;
  if (rolePath) {
    if (!existsSync(rolePath)) { console.error(`Missing role config: ${rolePath}`); process.exit(1); }
    const cfg = yaml.load(readFileSync(rolePath, 'utf-8')) || {};
    content = fromRoleConfig(cfg);
    slug = cfg.slug || `${slugify(common.NAME)}-${slugify(basename(rolePath, '.yml'))}`;
  } else {
    content = genericFromCvMd();
    slug = `${slugify(common.NAME)}-generic`;
  }

  const data = { ...common, ...content };
  const html = render(template, data);
  const file = outPath || resolve(OUT_DIR, `${slug}.html`);
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
  console.log(`Wrote: ${file}`);
  console.log(`Next:  node generate-pdf.mjs "${file}" "${file.replace(/\.html$/, '.pdf')}" --format=letter`);
}

main();
