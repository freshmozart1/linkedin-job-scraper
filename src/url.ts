import type { SearchParams } from './types';

const SEARCH_BASE_URL = 'https://www.linkedin.com/jobs/search';

// LinkedIn's public guest-search query codes for `f_TPR` (time posted range).
const DATE_POSTED_CODES: Record<NonNullable<SearchParams['datePosted']>, string> = {
  day: 'r86400',
  week: 'r604800',
  month: 'r2592000',
};

// `f_E` experience-level codes.
const EXPERIENCE_LEVEL_CODES: Record<NonNullable<SearchParams['experienceLevels']>[number], string> = {
  internship: '1',
  entry: '2',
  associate: '3',
  'mid-senior': '4',
  director: '5',
  executive: '6',
};

// `f_JT` job-type codes.
const JOB_TYPE_CODES: Record<NonNullable<SearchParams['jobTypes']>[number], string> = {
  'full-time': 'F',
  'part-time': 'P',
  contract: 'C',
  temporary: 'T',
  volunteer: 'V',
  internship: 'I',
  other: 'O',
};

// `f_WT` workplace-type codes.
const WORKPLACE_TYPE_CODES: Record<NonNullable<SearchParams['workplaceTypes']>[number], string> = {
  'on-site': '1',
  remote: '2',
  hybrid: '3',
};

// `sortBy` codes.
const SORT_BY_CODES: Record<NonNullable<SearchParams['sortBy']>, string> = {
  relevance: 'R',
  date: 'DD',
};

/**
 * Builds a LinkedIn guest job-search URL from caller-supplied search
 * parameters. Only `keywords` is required; every other field is optional
 * and, when omitted, simply isn't sent as a query param — nothing here is
 * defaulted or hardcoded.
 */
export function buildSearchUrl(params: SearchParams): string {
  const url = new URL(SEARCH_BASE_URL);
  url.searchParams.set('keywords', params.keywords);

  if (params.location !== undefined) url.searchParams.set('location', params.location);
  if (params.geoId !== undefined) url.searchParams.set('geoId', params.geoId);
  if (params.datePosted !== undefined) url.searchParams.set('f_TPR', DATE_POSTED_CODES[params.datePosted]);
  if (params.experienceLevels !== undefined && params.experienceLevels.length > 0) {
    url.searchParams.set('f_E', params.experienceLevels.map((level) => EXPERIENCE_LEVEL_CODES[level]).join(','));
  }
  if (params.jobTypes !== undefined && params.jobTypes.length > 0) {
    url.searchParams.set('f_JT', params.jobTypes.map((type) => JOB_TYPE_CODES[type]).join(','));
  }
  if (params.workplaceTypes !== undefined && params.workplaceTypes.length > 0) {
    url.searchParams.set('f_WT', params.workplaceTypes.map((type) => WORKPLACE_TYPE_CODES[type]).join(','));
  }
  if (params.distanceMiles !== undefined) url.searchParams.set('distance', String(params.distanceMiles));
  if (params.sortBy !== undefined) url.searchParams.set('sortBy', SORT_BY_CODES[params.sortBy]);

  for (const [key, value] of Object.entries(params.extraParams ?? {})) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}
