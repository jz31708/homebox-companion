import re
from pathlib import Path

DB_PATH = Path('frontend/src/lib/services/bulkMissionDb.ts')
BASE_PATH = Path('frontend/src/lib/workflows/bulkSweepBase.svelte.ts')

text = DB_PATH.read_text()
text = re.sub(
    r"(?:const DISCARD_MARKER_PREFIX = 'hbc-bulk-discarded:';\n)+",
    "const DISCARD_MARKER_PREFIX = 'hbc-bulk-discarded:';\n",
    text,
)

canonical_helpers = """function discardMarkerKey(missionId: string): string {
	return `${DISCARD_MARKER_PREFIX}${missionId}`;
}

export function markMissionDiscarded(missionId: string): void {
	requireBrowser();
	try {
		localStorage.setItem(discardMarkerKey(missionId), String(Date.now()));
	} catch {
		// IndexedDB deletion still runs when storage policy blocks localStorage.
	}
}

function isMissionDiscarded(missionId: string): boolean {
	if (!browser) return false;
	try {
		return localStorage.getItem(discardMarkerKey(missionId)) !== null;
	} catch {
		return false;
	}
}

function discardedMissionIds(now = Date.now()): string[] {
	if (!browser) return [];
	const ids: string[] = [];
	try {
		for (let index = localStorage.length - 1; index >= 0; index -= 1) {
			const marker = localStorage.key(index);
			if (!marker?.startsWith(DISCARD_MARKER_PREFIX)) continue;
			const missionId = marker.slice(DISCARD_MARKER_PREFIX.length);
			const markedAt = Number(localStorage.getItem(marker) ?? now);
			if (!missionId) {
				localStorage.removeItem(marker);
				continue;
			}
			if (Number.isFinite(markedAt) && now - markedAt > MISSION_TTL_MS) {
				localStorage.removeItem(marker);
				continue;
			}
			ids.push(missionId);
		}
	} catch {
		return ids;
	}
	return ids;
}

"""
start = text.index('function discardMarkerKey(')
end = text.index('function getDb()', start)
text = text[:start] + canonical_helpers + text[end:]
DB_PATH.write_text(text)

base = BASE_PATH.read_text()
for method in ('discardPersistedMission', 'continueSameArea', 'finishLocation'):
    marker = 'bulkMissionDb.markMissionDiscarded(missionId);'
    method_start = base.index(f'async {method}(')
    next_method = base.find('\n\tasync ', method_start + 1)
    if next_method < 0:
        next_method = len(base)
    section = base[method_start:next_method]
    while section.count(marker) > 1:
        section = section.replace(f'\n\t\t{marker}', '', 1)
    base = base[:method_start] + section + base[next_method:]
BASE_PATH.write_text(base)
