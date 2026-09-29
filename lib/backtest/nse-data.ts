import { strFromU8, unzipSync } from 'fflate';

import type { CmRow, CycleSnapshot, FoRow } from './types';

const NSE_ARCHIVE_HEADERS = {
  Accept: 'application/zip,*/*',
  Referer: 'https://www.nseindia.com/',
  'User-Agent': 'Mozilla/5.0 (compatible; FNOResearchPreflight/1.0)',
};

const reportCache = new Map<string, Promise<FoRow[] | null>>();
const cashReportCache = new Map<string, Promise<CmRow[] | null>>();

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function compactDate(value: string) {
  return value.replaceAll('-', '');
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

function isWeekend(value: string) {
  const day = new Date(`${value}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

async function fetchArchive(url: string) {
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(url, { headers: NSE_ARCHIVE_HEADERS, cache: 'no-store' });
    if (![429, 502, 503, 504].includes(response.status)) return response;
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  return response!;
}

function parseCsvLine(line: string) {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      fields.push(field);
      field = '';
    } else field += character;
  }
  fields.push(field);
  return fields;
}

function number(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseFoBhavcopyZip(bytes: Uint8Array): FoRow[] {
  const files = unzipSync(bytes);
  const csvName = Object.keys(files).find((name) => name.toLowerCase().endsWith('.csv'));
  if (!csvName) throw new Error('NSE F&O archive did not contain a CSV file.');
  const lines = strFromU8(files[csvName]).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('NSE F&O CSV is empty.');
  const headers = parseCsvLine(lines[0]);
  const column = (name: string) => {
    const index = headers.indexOf(name);
    if (index < 0) throw new Error(`NSE F&O CSV is missing ${name}.`);
    return index;
  };
  const optionalColumn = (name: string) => headers.indexOf(name);
  const indexes = {
    tradingDate: column('TradDt'), instrumentType: column('FinInstrmTp'), ticker: column('TckrSymb'),
    expiryDate: column('XpryDt'), strike: column('StrkPric'), optionType: column('OptnTp'),
    instrumentName: column('FinInstrmNm'), previousClose: column('PrvsClsgPric'), underlyingPrice: column('UndrlygPric'),
    open: column('OpnPric'), high: column('HghPric'), low: column('LwPric'), close: column('ClsPric'),
    tradedVolume: column('TtlTradgVol'), tradedValue: column('TtlTrfVal'), lotSize: column('NewBrdLotQty'),
    openInterest: optionalColumn('OpnIntrst'), changeInOpenInterest: optionalColumn('ChngInOpnIntrst'),
  };
  return lines.slice(1).map((line) => parseCsvLine(line)).filter((row) => row.length >= headers.length - 2).map((row) => ({
    tradingDate: row[indexes.tradingDate],
    instrumentType: row[indexes.instrumentType],
    ticker: row[indexes.ticker],
    expiryDate: row[indexes.expiryDate],
    strike: number(row[indexes.strike]),
    optionType: row[indexes.optionType] === 'CE' || row[indexes.optionType] === 'PE' ? row[indexes.optionType] as 'CE' | 'PE' : '',
    instrumentName: row[indexes.instrumentName],
    open: number(row[indexes.open]),
    high: number(row[indexes.high]),
    low: number(row[indexes.low]),
    close: number(row[indexes.close]),
    previousClose: number(row[indexes.previousClose]),
    underlyingPrice: number(row[indexes.underlyingPrice]),
    tradedVolume: number(row[indexes.tradedVolume]),
    tradedValue: number(row[indexes.tradedValue]),
    lotSize: number(row[indexes.lotSize]),
    openInterest: indexes.openInterest >= 0 ? number(row[indexes.openInterest]) : 0,
    changeInOpenInterest: indexes.changeInOpenInterest >= 0 ? number(row[indexes.changeInOpenInterest]) : 0,
  }));
}

export function parseCmBhavcopyZip(bytes: Uint8Array): CmRow[] {
  const files = unzipSync(bytes);
  const csvName = Object.keys(files).find((name) => name.toLowerCase().endsWith('.csv'));
  if (!csvName) throw new Error('NSE cash archive did not contain a CSV file.');
  const lines = strFromU8(files[csvName]).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('NSE cash CSV is empty.');
  const headers = parseCsvLine(lines[0]);
  const modern = headers.includes('TckrSymb');
  const at = (row: string[], name: string, legacy: string) => row[headers.indexOf(modern ? name : legacy)];
  return lines.slice(1).map(parseCsvLine).map((row) => ({
    ticker: at(row, 'TckrSymb', 'SYMBOL'),
    series: at(row, 'SctySrs', 'SERIES'),
    open: number(at(row, 'OpnPric', 'OPEN')),
    high: number(at(row, 'HghPric', 'HIGH')),
    low: number(at(row, 'LwPric', 'LOW')),
    close: number(at(row, 'ClsPric', 'CLOSE')),
    previousClose: number(at(row, 'PrvsClsgPric', 'PREVCLOSE')),
    tradedVolume: number(at(row, 'TtlTradgVol', 'TOTTRDQTY')),
    tradedValue: number(at(row, 'TtlTrfVal', 'TOTTRDVAL')),
  })).filter((row) => row.ticker);
}

export async function fetchCmReport(tradingDate: string) {
  if (!cashReportCache.has(tradingDate)) cashReportCache.set(tradingDate, (async () => {
    if (isWeekend(tradingDate)) return null;
    const url = `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${compactDate(tradingDate)}_F_0000.csv.zip`;
    const response = await fetchArchive(url);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`NSE cash archive returned HTTP ${response.status} for ${tradingDate}.`);
    return parseCmBhavcopyZip(new Uint8Array(await response.arrayBuffer()));
  })());
  return cashReportCache.get(tradingDate)!;
}

export function calendarDates(from: string, to: string) {
  const dates: string[] = [];
  for (let value = from; value <= to; value = addDays(value, 1)) dates.push(value);
  return dates;
}

export async function fetchFoReport(tradingDate: string) {
  if (!reportCache.has(tradingDate)) reportCache.set(tradingDate, (async () => {
    if (isWeekend(tradingDate)) return null;
    const url = `https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_${compactDate(tradingDate)}_F_0000.csv.zip`;
    const response = await fetchArchive(url);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`NSE F&O archive returned HTTP ${response.status} for ${tradingDate}.`);
    return parseFoBhavcopyZip(new Uint8Array(await response.arrayBuffer()));
  })());
  return reportCache.get(tradingDate)!;
}

export function releaseFoReport(tradingDate: string) {
  reportCache.delete(tradingDate);
}

export function clearFoReportCache() {
  reportCache.clear();
}

export function clearNseReportCaches() {
  reportCache.clear();
  cashReportCache.clear();
}

async function firstReportBetween(from: string, to: string, descending = false) {
  const dates: string[] = [];
  for (let value = from; value <= to; value = addDays(value, 1)) dates.push(value);
  if (descending) dates.reverse();
  for (const date of dates) {
    const rows = await fetchFoReport(date);
    if (rows?.length) return { date, rows };
  }
  return null;
}

async function expiryForMonth(year: number, monthIndex: number, today: string) {
  const monthStart = dateOnly(new Date(Date.UTC(year, monthIndex, 1)));
  const monthEnd = dateOnly(new Date(Date.UTC(year, monthIndex + 1, 0)));
  const probeEnd = dateOnly(new Date(Date.UTC(year, monthIndex, Math.min(10, new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()))));
  const report = await firstReportBetween(monthStart, probeEnd);
  if (!report) return null;
  const expiries = [...new Set(report.rows.filter((row) => row.instrumentType === 'STO' && row.optionType && row.expiryDate.startsWith(monthStart.slice(0, 7))).map((row) => row.expiryDate))].sort();
  const expiryDate = expiries.at(-1);
  if (!expiryDate || expiryDate >= today || expiryDate > monthEnd) return null;
  return expiryDate;
}

export async function discoverCompletedMonthlyCycles(today = dateOnly(new Date()), count = 6): Promise<CycleSnapshot[]> {
  const todayDate = new Date(`${today}T00:00:00Z`);
  const expiries: string[] = [];
  for (let offset = 0; expiries.length < count + 1 && offset < 18; offset += 1) {
    const month = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() - offset, 1));
    const expiry = await expiryForMonth(month.getUTCFullYear(), month.getUTCMonth(), today);
    if (expiry) expiries.push(expiry);
  }
  if (expiries.length < count + 1) throw new Error(`Only ${Math.max(0, expiries.length - 1)} completed monthly cycles could be reconstructed; ${count} are required.`);
  const sorted = expiries.sort();
  const selected = sorted.slice(-count);
  const cycles: CycleSnapshot[] = [];
  for (const expiryDate of selected) {
    const previousExpiry = sorted[sorted.indexOf(expiryDate) - 1];
    const entryReport = await firstReportBetween(addDays(previousExpiry, 1), addDays(previousExpiry, 10));
    const previousReport = await firstReportBetween(addDays(entryReport?.date ?? previousExpiry, -10), addDays(entryReport?.date ?? previousExpiry, -1), true);
    const t1Report = await firstReportBetween(addDays(expiryDate, -10), addDays(expiryDate, -1), true);
    if (!entryReport || !previousReport || !t1Report) throw new Error(`Trading-day boundaries could not be reconstructed for expiry ${expiryDate}.`);
    cycles.push({
      expiryDate,
      firstEligibleTradingDay: entryReport.date,
      entryTimestamp: `${entryReport.date}T09:20:00+05:30`,
      previousTradingDay: previousReport.date,
      t1TradingDay: t1Report.date,
      rankingRows: previousReport.rows,
    });
  }
  return cycles.sort((a, b) => b.expiryDate.localeCompare(a.expiryDate));
}

export function rankHistoricalUniverse(cycle: CycleSnapshot, limit = 50) {
  const eligible = new Map<string, FoRow[]>();
  for (const row of cycle.rankingRows) {
    if (row.instrumentType !== 'STO' || row.expiryDate !== cycle.expiryDate || !row.optionType) continue;
    const rows = eligible.get(row.ticker) ?? [];
    rows.push(row);
    eligible.set(row.ticker, rows);
  }
  return [...eligible.entries()].map(([ticker, optionRows]) => ({
    ticker,
    liquidityMetric: cycle.rankingRows.filter((row) => row.ticker === ticker).reduce((sum, row) => sum + row.tradedValue, 0),
    lotSize: optionRows.find((row) => row.lotSize > 0)?.lotSize ?? null,
    contracts: optionRows.filter((row) => row.instrumentName && row.strike > 0).map((row) => ({ strike: row.strike, optionType: row.optionType as 'CE' | 'PE', fyersSymbol: `NSE:${row.instrumentName}` })),
  })).sort((a, b) => b.liquidityMetric - a.liquidityMetric || a.ticker.localeCompare(b.ticker)).slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 }));
}

export const nseDataInternals = { addDays, dateOnly };
