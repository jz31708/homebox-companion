from pathlib import Path

# One-shot correction. The workflow and this script are removed after green validation.
DB_PATH = Path('frontend/src/lib/services/bulkMissionDb.ts')
BASE_PATH = Path('frontend/src/lib/workflows/bulkSweepBase.svelte.ts')

text = DB_PATH.read_text()

text = text.replace(
    "const MISSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;\n",
    "const MISSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;\nconst DISCARD_MARKER_PREFIX = 'hbc-bulk-discarded:';\n",
)

anchor = "function requireBrowser(): void {\n\tif (!browser) throw new Error('Bulk mission storage is only available in the browser');\n}\n"
helpers = """function requireBrowser(): void {
	if (!browser) throw new Error('Bulk mission storage is only available in the browser');
}

function discardMarkerKey(missionId: string): string {
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
if anchor in text:
    text = text.replace(anchor, helpers)

text = text.replace(
    "export async function saveMission(mission: BulkMissionRecord): Promise<void> {\n\tawait serializedWrite(async () => {\n",
    "export async function saveMission(mission: BulkMissionRecord): Promise<void> {\n\tif (isMissionDiscarded(mission.id)) return;\n\tawait serializedWrite(async () => {\n\t\tif (isMissionDiscarded(mission.id)) return;\n",
)

text = text.replace(
    "async function saveMissionScopedRecord<T extends { missionId: string; id: string }>(\n\tstoreName: Exclude<StoreName, 'missions' | 'photos' | 'meta'>,\n\trecord: T,\n\tmissionListField: Exclude<MissionListField, 'photoIds'>\n): Promise<void> {\n\tawait serializedWrite(async () => {\n",
    "async function saveMissionScopedRecord<T extends { missionId: string; id: string }>(\n\tstoreName: Exclude<StoreName, 'missions' | 'photos' | 'meta'>,\n\trecord: T,\n\tmissionListField: Exclude<MissionListField, 'photoIds'>\n): Promise<void> {\n\tif (isMissionDiscarded(record.missionId)) return;\n\tawait serializedWrite(async () => {\n\t\tif (isMissionDiscarded(record.missionId)) return;\n",
)

text = text.replace(
    ".filter((mission) => mission.status !== 'complete')\n",
    ".filter((mission) => mission.status !== 'complete' && !isMissionDiscarded(mission.id))\n",
)
text = text.replace(
    "return missions.filter((mission) => mission.status !== 'complete');\n",
    "return missions.filter(\n\t\t(mission) => mission.status !== 'complete' && !isMissionDiscarded(mission.id)\n\t);\n",
)
text = text.replace(
    "export async function loadMissionBundle(missionId: string): Promise<BulkMissionBundle | null> {\n\trequireBrowser();\n",
    "export async function loadMissionBundle(missionId: string): Promise<BulkMissionBundle | null> {\n\trequireBrowser();\n\tif (isMissionDiscarded(missionId)) return null;\n",
)
text = text.replace(
    "export async function discardMission(missionId: string): Promise<void> {\n\tawait serializedWrite(async () => {\n",
    "export async function discardMission(missionId: string): Promise<void> {\n\tmarkMissionDiscarded(missionId);\n\tawait serializedWrite(async () => {\n",
)
text = text.replace(
    "export async function cleanupStaleMissions(now = Date.now()): Promise<void> {\n\tconst missions = await listRecoverableMissions();\n",
    "export async function cleanupStaleMissions(now = Date.now()): Promise<void> {\n\tfor (const missionId of discardedMissionIds(now)) await discardMission(missionId);\n\tconst missions = await listRecoverableMissions();\n",
)
text = text.replace(
    "export async function resetDatabaseForTests(): Promise<void> {\n\tif (!browser) return;\n",
    "export async function resetDatabaseForTests(): Promise<void> {\n\tif (!browser) return;\n\ttry {\n\t\tfor (let index = localStorage.length - 1; index >= 0; index -= 1) {\n\t\t\tconst marker = localStorage.key(index);\n\t\t\tif (marker?.startsWith(DISCARD_MARKER_PREFIX)) localStorage.removeItem(marker);\n\t\t}\n\t} catch {\n\t\t// Test reset still deletes IndexedDB when localStorage is unavailable.\n\t}\n",
)

DB_PATH.write_text(text)

base = BASE_PATH.read_text()
base = base.replace(
    "\tasync discardPersistedMission(): Promise<void> {\n\t\tconst missionId = this.missionId;\n\t\tthis.invalidateQueuedWrites();\n",
    "\tasync discardPersistedMission(): Promise<void> {\n\t\tconst missionId = this.missionId;\n\t\tbulkMissionDb.markMissionDiscarded(missionId);\n\t\tthis.invalidateQueuedWrites();\n",
)
base = base.replace(
    "\t\tconst missionId = this.missionId;\n\t\tthis.invalidateQueuedWrites();\n\t\tawait this.durableWriteQueue;\n\t\tawait bulkMissionDb.discardMission(missionId);\n\t\tthis.reset();\n\t\tif (locationId",
    "\t\tconst missionId = this.missionId;\n\t\tbulkMissionDb.markMissionDiscarded(missionId);\n\t\tthis.invalidateQueuedWrites();\n\t\tawait this.durableWriteQueue;\n\t\tawait bulkMissionDb.discardMission(missionId);\n\t\tthis.reset();\n\t\tif (locationId",
)
base = base.replace(
    "\tasync finishLocation(): Promise<void> {\n\t\tconst missionId = this.missionId;\n\t\tthis.invalidateQueuedWrites();\n",
    "\tasync finishLocation(): Promise<void> {\n\t\tconst missionId = this.missionId;\n\t\tbulkMissionDb.markMissionDiscarded(missionId);\n\t\tthis.invalidateQueuedWrites();\n",
)
BASE_PATH.write_text(base)
