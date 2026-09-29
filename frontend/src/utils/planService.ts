import { db, loadFlightLine, splitSorties } from './db';
import {
  calcGsd,
  estimateBatteries,
  estimateDuration,
  estimatePhotos,
  lineSpacing,
  pathLengthMeters,
  photoInterval,
  polygonAreaM2,
} from './geoCalc';
import { newId } from './id';
import type { FlightLineSnapshot, PlanVersion, SortieRecord, WaypointSnapshot } from '../types/planVersion';
import type { Mission, MissionStatus } from '../types/mission';
import type { FlightLine } from '../types/flightline';
import type { Waypoint } from '../types/waypoint';

export class PlanConflictError extends Error {
  constructor(message = '版本冲突：方案已被另一个页面先提交，请刷新后再操作') {
    super(message);
    this.name = 'PlanConflictError';
  }
}

export class PlanValidationError extends Error {}

function stableString(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableString).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableString((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  const input = stableString(value);
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return `fp_${(hash >>> 0).toString(16)}_${input.length}`;
}

function snapshotWaypoints(waypoints: Waypoint[]): WaypointSnapshot[] {
  return waypoints
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((w) => ({
      seq: w.seq,
      lng: w.lng,
      lat: w.lat,
      altitude: w.altitude,
      speed: w.speed,
      heading: w.heading,
      gimbalPitch: w.gimbalPitch,
      action: w.action,
      hoverSec: w.hoverSec,
    }));
}

export function buildRouteSnapshot(
  mission: Mission,
  line: FlightLine | undefined,
  waypoints: Waypoint[],
): FlightLineSnapshot {
  const altitude = waypoints[0]?.altitude ?? 120;
  const speed = waypoints[0]?.speed ?? 8;
  const heading = line?.heading ?? waypoints[0]?.heading ?? 90;
  const overlapForward = line?.overlapForward ?? 75;
  const overlapSide = line?.overlapSide ?? 70;
  const gsd = line?.gsd ?? calcGsd(mission.pixelSize, altitude, mission.focalLength);
  const points = waypoints
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((w) => [w.lng, w.lat] as [number, number]);
  const pathLength = pathLengthMeters(points);
  const area = polygonAreaM2(mission.areaPolygon);
  const side = area > 0 ? Math.sqrt(area) : 0;
  const spacing = line?.spacing ?? lineSpacing(mission.sensorWidth, altitude, mission.focalLength, overlapSide);
  const interval =
    line?.photoInterval ?? photoInterval(mission.sensorHeight, altitude, mission.focalLength, overlapForward);
  const lineCount = spacing > 0 && side > 0 ? Math.max(1, Math.ceil(side / spacing)) : Math.max(1, points.length);
  const estPhotos =
    line?.estPhotos ?? estimatePhotos(area > 0 ? Math.sqrt(area) : Math.max(pathLength, 1), interval, lineCount);
  const hoverSecTotal = waypoints
    .filter((w) => w.action === '悬停')
    .reduce((sum, w) => sum + w.hoverSec, 0);
  const estDuration = line?.estDuration ?? estimateDuration(pathLength, speed, points.length, hoverSecTotal);
  return {
    altitude,
    speed,
    spacing,
    photoInterval: interval,
    overlapForward,
    overlapSide,
    gsd,
    estPhotos: estPhotos || points.length,
    estDuration: estDuration || 1,
    batteryCount: line?.batteryCount ?? estimateBatteries(estDuration || 1),
    heading,
  };
}

async function readVersionMaterials(missionId: string) {
  const [mission, line, waypoints] = await Promise.all([
    db.missions.get(missionId),
    loadFlightLine(missionId),
    db.waypoints.where('missionId').equals(missionId).toArray(),
  ]);
  if (!mission) throw new PlanValidationError('未找到任务');
  const sortedWaypoints = waypoints.sort((a, b) => a.seq - b.seq);
  return { mission, line, waypoints: sortedWaypoints, route: buildRouteSnapshot(mission, line, sortedWaypoints) };
}

function makeVersion(
  mission: Mission,
  route: FlightLineSnapshot,
  waypointSnapshots: WaypointSnapshot[],
  fields: Pick<PlanVersion, 'versionNo' | 'status' | 'reason' | 'createdAt'> & {
    frozenAt?: number;
    flownAt?: number;
  },
): PlanVersion {
  const camera = {
    cameraModel: mission.cameraModel,
    sensorWidth: mission.sensorWidth,
    sensorHeight: mission.sensorHeight,
    focalLength: mission.focalLength,
    pixelSize: mission.pixelSize,
  };
  return {
    id: newId('plan'),
    missionId: mission.id,
    camera,
    route,
    waypoints: waypointSnapshots,
    fingerprint: fingerprint({ camera, route, waypoints: waypointSnapshots }),
    ...fields,
  };
}

function createSorties(version: PlanVersion, now: number): SortieRecord[] {
  const lineForSplit: FlightLine = {
    id: 'split',
    missionId: version.missionId,
    lineNo: 1,
    spacing: version.route.spacing,
    photoInterval: version.route.photoInterval,
    overlapForward: version.route.overlapForward,
    overlapSide: version.route.overlapSide,
    gsd: version.route.gsd,
    estPhotos: version.route.estPhotos,
    estDuration: version.route.estDuration,
    batteryCount: version.route.batteryCount,
    heading: version.route.heading,
    updatedAt: now,
  };
  return splitSorties(lineForSplit).map((item) => ({
    id: newId('sortie'),
    missionId: version.missionId,
    planVersionId: version.id,
    sortieNo: item.sortie,
    plannedPhotos: item.photos,
    plannedDurationMin: item.durationMin,
    status: '待飞',
    createdAt: now,
  }));
}

async function markPriorVersions(missionId: string, keepVersionId: string): Promise<void> {
  const prior = await db.planVersions.where('missionId').equals(missionId).toArray();
  await Promise.all(
    prior
      .filter((v) => v.id !== keepVersionId && v.status === '冻结')
      .map((v) => db.planVersions.update(v.id, { status: '已替代' })),
  );
}

async function putVersionAndSorties(version: PlanVersion, now: number, replacePrior: boolean): Promise<SortieRecord[]> {
  const sorties = createSorties(version, now);
  await db.transaction('rw', [db.planVersions, db.sorties], async () => {
    await db.planVersions.put(version);
    if (replacePrior) await markPriorVersions(version.missionId, version.id);
    await db.sorties.bulkPut(sorties);
  });
  return sorties;
}

/** 老任务启动时补初始版本；已有成果绑定到首架次，保留当时航高/重叠率/GSD。 */
export async function ensureMissionPlan(mission: Mission): Promise<PlanVersion | undefined> {
  const existing = await db.planVersions.where('missionId').equals(mission.id).toArray();
  if (existing.length > 0) return existing.sort((a, b) => b.versionNo - a.versionNo)[0];
  // 新建任务可直接选择非规划状态；老任务启动也在此补初始版本
  if (mission.status === '规划中') return undefined;

  const materials = await readVersionMaterials(mission.id);
  const now = Date.now();
  const version = makeVersion(mission, materials.route, snapshotWaypoints(materials.waypoints), {
    versionNo: 1,
    status: mission.status === '待飞行' ? '冻结' : '已飞',
    reason: '历史任务初始版本',
    createdAt: Math.min(mission.createdAt, now),
    frozenAt: now,
    flownAt: mission.status === '待飞行' ? undefined : now,
  });
  const sorties = await putVersionAndSorties(version, now, false);

  const unbound = await db.assets.where('missionId').equals(mission.id).toArray();
  if (unbound.length > 0 && sorties[0]) {
    const first = sorties[0];
    const reconcileFirst = mission.status === '已飞行' || mission.status === '已归档';
    await db.transaction('rw', [db.assets, db.sorties], async () => {
      await Promise.all(
        unbound.map((asset) =>
          db.assets.update(asset.id, { planVersionId: version.id, sortieId: first.id, receivedAt: asset.receivedAt ?? now }),
        ),
      );
      if (reconcileFirst) await db.sorties.update(first.id, { status: '已核销', reconciledAt: now });
    });
  }

  await db.missions.update(mission.id, { currentVersionId: version.id, archiveRevision: mission.archiveRevision ?? 0 });
  return version;
}

async function createWorkingVersion(missionId: string, reason: string): Promise<PlanVersion> {
  const materials = await readVersionMaterials(missionId);
  const versions = await db.planVersions.where('missionId').equals(missionId).toArray();
  const draft = versions.find((v) => v.status === '草稿');
  const now = Date.now();
  if (draft) {
    const updated: PlanVersion = {
      ...draft,
      camera: {
        cameraModel: materials.mission.cameraModel,
        sensorWidth: materials.mission.sensorWidth,
        sensorHeight: materials.mission.sensorHeight,
        focalLength: materials.mission.focalLength,
        pixelSize: materials.mission.pixelSize,
      },
      route: materials.route,
      waypoints: snapshotWaypoints(materials.waypoints),
      reason,
      createdAt: now,
    };
    updated.fingerprint = fingerprint({ camera: updated.camera, route: updated.route, waypoints: updated.waypoints });
    await db.planVersions.put(updated);
    return updated;
  }

  const nonDraftVersions = versions.filter((v) => v.status !== '草稿');

  const version = makeVersion(materials.mission, materials.route, snapshotWaypoints(materials.waypoints), {
    versionNo: nonDraftVersions.length + 1,
    status: '草稿',
    reason,
    createdAt: now,
  });
  await db.planVersions.put(version);
  return version;
}

/** 规划中的修改保存为草稿，不冻结参数。 */
export async function touchWorkingPlan(missionId: string): Promise<PlanVersion | undefined> {
  const mission = await db.missions.get(missionId);
  if (!mission || mission.status === '已归档') return undefined;
  if (mission.status === '规划中') return undefined;
  return createWorkingVersion(missionId, '方案参数已修改，待发布');
}

export async function transitionMissionStatus(
  missionId: string,
  next: MissionStatus,
  expectedRevision?: number,
): Promise<PlanVersion> {
  const mission = await db.missions.get(missionId);
  if (!mission) throw new PlanValidationError('未找到任务');
  if (mission.status === '已归档' && next !== '已归档') throw new PlanValidationError('已归档任务不能再修改方案');
  if (mission.status === '已归档' && next === '已归档') throw new PlanConflictError();

  if (mission.status !== '规划中') {
    const materials = await readVersionMaterials(missionId);
    if (materials.waypoints.length === 0) throw new PlanValidationError('至少需要一个航点才能冻结方案');
  }

  const now = Date.now();
  if (next === '待飞行') {
    const draft = (await db.planVersions.where('missionId').equals(missionId).toArray()).find((v) => v.status === '草稿');
    const materials = await readVersionMaterials(missionId);
    const versions = await db.planVersions.where('missionId').equals(missionId).toArray();
    const nonDraftVersions = versions.filter((v) => v.status !== '草稿');
    const version = makeVersion(materials.mission, materials.route, snapshotWaypoints(materials.waypoints), {
      versionNo: draft?.versionNo ?? nonDraftVersions.length + 1,
      status: '冻结',
      reason: draft?.reason ?? '进入待飞行冻结方案',
      createdAt: now,
      frozenAt: now,
    });
    await putVersionAndSorties(version, now, nonDraftVersions.length > 0);
    if (draft) await db.planVersions.delete(draft.id);
    await db.missions.update(missionId, { currentVersionId: version.id, status: next, archiveConflict: undefined });
    return version;
  }

  const currentId = mission.currentVersionId;
  const current = currentId ? await db.planVersions.get(currentId) : undefined;
  if (!current) throw new PlanValidationError('任务缺少冻结版本，请先生成方案版本');

  if (next === '已飞行') {
    await db.transaction('rw', [db.missions, db.planVersions], async () => {
      await db.planVersions.update(current.id, { status: '已飞', flownAt: now });
      await db.missions.update(missionId, { status: next, archiveConflict: undefined });
    });
    return { ...current, status: '已飞', flownAt: now };
  }

  if (next === '已归档') {
    const revision = mission.archiveRevision ?? 0;
    if (expectedRevision !== undefined && expectedRevision !== revision) throw new PlanConflictError();
    const sorties = await db.sorties.where('missionId').equals(missionId).toArray();
    const assets = await db.assets.where('missionId').equals(missionId).toArray();
    if (sorties.length === 0) {
      throw new PlanValidationError('当前版本缺少架次记录，请重新冻结方案');
    }
    const unbound = assets.some((a) => !a.planVersionId || !a.sortieId);
    const unreconciled = sorties.some((s) => s.status !== '已核销');
    if (assets.length === 0 || unbound || unreconciled) {
      throw new PlanValidationError(
        `不能归档：${assets.length === 0 ? '尚无绑定影像；' : ''}${unbound ? '存在未绑定影像；' : ''}${
          unreconciled ? '存在未核销架次；' : ''
        }`,
      );
    }
    const nextRevision = revision + 1;
    await db.transaction('rw', [db.missions], async () => {
      const latest = await db.missions.get(missionId);
      const latestRevision = latest?.archiveRevision ?? 0;
      if (latestRevision !== revision) throw new PlanConflictError();
      await db.missions.update(missionId, { status: '已归档', archiveRevision: nextRevision, archiveConflict: undefined });
    });
    return current;
  }

  await db.missions.update(missionId, { status: next });
  return current;
}

export async function markSortieReconciled(sortieId: string): Promise<void> {
  const sortie = await db.sorties.get(sortieId);
  if (!sortie) throw new PlanValidationError('未找到架次');
  const count = await db.assets.where('sortieId').equals(sortieId).count();
  if (count === 0) throw new PlanValidationError('该架次尚无绑定影像，不能核销');
  if (sortie.status === '已核销') return;
  await db.sorties.update(sortieId, { status: '已核销', reconciledAt: Date.now() });
}

export async function bindAssetToSortie(assetId: string, sortieId: string): Promise<void> {
  const [asset, sortie] = await Promise.all([db.assets.get(assetId), db.sorties.get(sortieId)]);
  if (!asset || !sortie) throw new PlanValidationError('未找到影像或架次');
  await db.assets.update(assetId, {
    sortieId,
    planVersionId: sortie.planVersionId,
    receivedAt: asset.receivedAt ?? Date.now(),
  });
}
