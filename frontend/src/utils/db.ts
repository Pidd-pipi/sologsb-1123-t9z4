import Dexie, { type Table } from 'dexie';
import type { CameraPreset, Mission } from '../types/mission';
import type { Waypoint } from '../types/waypoint';
import type { FlightLine } from '../types/flightline';
import { makeThumbDataUrl, type AssetThumb, type ImageAsset } from '../types/imageasset';
import type { SchemeVersion } from '../types/scheme';
import { newId } from './id';

export const DB_NAME = 'gbdronemap';
export const DB_VERSION = 3;
export const LS_VERSION_KEY = 'gbdronemap:db-version';

class DroneMapDB extends Dexie {
  missions!: Table<Mission, string>;
  waypoints!: Table<Waypoint, string>;
  lines!: Table<FlightLine, string>;
  assets!: Table<ImageAsset, string>;
  thumbs!: Table<AssetThumb, string>;
  presets!: Table<CameraPreset, string>;
  schemes!: Table<SchemeVersion, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      missions: 'id, missionNo, areaName, droneModel, flightDate, status, createdAt',
      waypoints: 'id, missionId, seq, action',
      lines: 'id, missionId, lineNo',
      assets: 'id, missionId, imageNo, quality',
      thumbs: 'id, missionId',
      presets: 'id, name, cameraModel',
    });
    this.version(2)
      .stores({
        missions: 'id, missionNo, areaName, droneModel, flightDate, status, purpose, createdAt',
        waypoints: 'id, missionId, seq, action, altitude',
        lines: 'id, missionId, lineNo, updatedAt',
        assets: 'id, missionId, imageNo, quality, shotAt',
        thumbs: 'id, missionId',
        presets: 'id, name, cameraModel',
      })
      .upgrade(async (tx) => {
        await tx
          .table('missions')
          .toCollection()
          .modify((row: any) => {
            if (!row.areaPolygon) row.areaPolygon = [];
            if (row.sensorWidth === undefined) row.sensorWidth = 13.2;
            if (row.sensorHeight === undefined) row.sensorHeight = 8.8;
            if (row.focalLength === undefined) row.focalLength = 8.8;
            if (row.pixelSize === undefined) row.pixelSize = 2.4;
          });
        await tx
          .table('lines')
          .toCollection()
          .modify((row: any) => {
            if (row.updatedAt === undefined) row.updatedAt = Date.now();
            if (row.batteryCount === undefined) row.batteryCount = 1;
          });
      });
    this.version(3)
      .stores({
        missions: 'id, missionNo, areaName, droneModel, flightDate, status, purpose, createdAt, currentVersion',
        waypoints: 'id, missionId, seq, action, altitude',
        lines: 'id, missionId, lineNo, updatedAt',
        assets: 'id, missionId, imageNo, quality, shotAt, sortieNo',
        thumbs: 'id, missionId',
        presets: 'id, name, cameraModel',
        schemes: 'id, missionId, versionNo, archivedAt',
      })
      .upgrade(async (tx) => {
        // 为每个老任务补 currentVersion / archiveVersion，并生成初始方案版本快照
        const missions = await tx.table('missions').toArray();
        for (const mission of missions) {
          if (mission.currentVersion === undefined) {
            mission.currentVersion = 1;
            mission.archiveVersion = 0;
            await tx.table('missions').put(mission);
          }
          const existingCount = await tx.table('schemes').where('missionId').equals(mission.id).count();
          if (existingCount > 0) continue;
          const waypoints = await tx
            .table('waypoints')
            .where('missionId')
            .equals(mission.id)
            .sortBy('seq');
          const lineRows = await tx.table('lines').where('missionId').equals(mission.id).toArray();
          const line = lineRows.sort((a: FlightLine, b: FlightLine) => a.lineNo - b.lineNo)[0];
          const snapshot: SchemeVersion = {
            id: newId('scheme'),
            missionId: mission.id,
            versionNo: 1,
            waypoints: waypoints.map((wp: Waypoint) => ({
              seq: wp.seq,
              lng: wp.lng,
              lat: wp.lat,
              altitude: wp.altitude,
              speed: wp.speed,
              heading: wp.heading,
              gimbalPitch: wp.gimbalPitch,
              action: wp.action,
              hoverSec: wp.hoverSec,
            })),
            camera: {
              cameraModel: mission.cameraModel,
              sensorWidth: mission.sensorWidth,
              sensorHeight: mission.sensorHeight,
              focalLength: mission.focalLength,
              pixelSize: mission.pixelSize,
            },
            line: line
              ? {
                  spacing: line.spacing,
                  photoInterval: line.photoInterval,
                  overlapForward: line.overlapForward,
                  overlapSide: line.overlapSide,
                  gsd: line.gsd,
                  estPhotos: line.estPhotos,
                  estDuration: line.estDuration,
                  batteryCount: line.batteryCount,
                  heading: line.heading,
                }
              : {
                  spacing: 0,
                  photoInterval: 0,
                  overlapForward: 75,
                  overlapSide: 70,
                  gsd: 0,
                  estPhotos: 0,
                  estDuration: 0,
                  batteryCount: 1,
                  heading: 90,
                },
            sorties: line
              ? splitSorties(line).map((s) => ({ sortieNo: s.sortie, photos: s.photos, durationMin: s.durationMin }))
              : [],
            createdAt: mission.createdAt,
            archiveVersion: 0,
          };
          await tx.table('schemes').put(snapshot);
        }
      });
  }
}

export const db = new DroneMapDB();

export function markDbVersion(): void {
  try {
    window.localStorage.setItem(LS_VERSION_KEY, String(DB_VERSION));
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

export function readDbVersion(): number {
  try {
    const raw = window.localStorage.getItem(LS_VERSION_KEY);
    return raw ? Number(raw) : DB_VERSION;
  } catch {
    return DB_VERSION;
  }
}

/** 读取某任务的航线参数（每任务一条） */
export async function loadFlightLine(missionId: string): Promise<FlightLine | undefined> {
  const rows = await db.lines.where('missionId').equals(missionId).toArray();
  return rows.sort((a, b) => a.lineNo - b.lineNo)[0];
}

/** 保存 / 更新航线参数 */
export async function saveFlightLine(line: FlightLine): Promise<void> {
  await db.lines.put(line);
}

/** 按航线参数把任务拆分为多架次（每架次按电池组数分组） */
export function splitSorties(line: FlightLine): { sortie: number; photos: number; durationMin: number }[] {
  const perSortie = 20; // 每组电池有效续航 20 min
  const count = Math.max(1, Math.ceil(line.estDuration / perSortie));
  const photosPer = Math.ceil(line.estPhotos / count);
  const durationPer = Math.round((line.estDuration / count) * 10) / 10;
  return Array.from({ length: count }, (_, i) => ({
    sortie: i + 1,
    photos: photosPer,
    durationMin: durationPer,
  }));
}

/** 读取某任务的所有方案版本（按版本号升序） */
export async function loadSchemeVersions(missionId: string): Promise<SchemeVersion[]> {
  const rows = await db.schemes.where('missionId').equals(missionId).toArray();
  return rows.sort((a, b) => a.versionNo - b.versionNo);
}

/** 由当前任务、航点、航线参数构建方案快照（不写库） */
export async function buildSchemeSnapshot(mission: Mission): Promise<Omit<SchemeVersion, 'id' | 'missionId' | 'versionNo' | 'createdAt' | 'archiveVersion'>> {
  const waypoints = await db.waypoints.where('missionId').equals(mission.id).sortBy('seq');
  const line = await loadFlightLine(mission.id);
  return {
    waypoints: waypoints.map((wp) => ({
      seq: wp.seq,
      lng: wp.lng,
      lat: wp.lat,
      altitude: wp.altitude,
      speed: wp.speed,
      heading: wp.heading,
      gimbalPitch: wp.gimbalPitch,
      action: wp.action,
      hoverSec: wp.hoverSec,
    })),
    camera: {
      cameraModel: mission.cameraModel,
      sensorWidth: mission.sensorWidth,
      sensorHeight: mission.sensorHeight,
      focalLength: mission.focalLength,
      pixelSize: mission.pixelSize,
    },
    line: line
      ? {
          spacing: line.spacing,
          photoInterval: line.photoInterval,
          overlapForward: line.overlapForward,
          overlapSide: line.overlapSide,
          gsd: line.gsd,
          estPhotos: line.estPhotos,
          estDuration: line.estDuration,
          batteryCount: line.batteryCount,
          heading: line.heading,
        }
      : {
          spacing: 0,
          photoInterval: 0,
          overlapForward: 75,
          overlapSide: 70,
          gsd: 0,
          estPhotos: 0,
          estDuration: 0,
          batteryCount: 1,
          heading: 90,
        },
    sorties: line
      ? splitSorties(line).map((s) => ({ sortieNo: s.sortie, photos: s.photos, durationMin: s.durationMin }))
      : [],
  };
}

/** 首次进入灌入示范任务、航点、航线参数与成果影像条目 */
export async function ensureSeedData(): Promise<void> {
  const count = await db.missions.count();
  if (count > 0) return;

  const now = Date.now();
  const day = 24 * 3600 * 1000;

  const missionA = newId('mission');
  const missionB = newId('mission');

  const polygonA: [number, number][] = [
    [116.3912, 39.9075],
    [116.3978, 39.9075],
    [116.3978, 39.9032],
    [116.3912, 39.9032],
  ];
  const polygonB: [number, number][] = [
    [121.4726, 31.2321],
    [121.4789, 31.2334],
    [121.4796, 31.2288],
  ];

  const missions: Mission[] = [
    {
      id: missionA,
      missionNo: 'DM-2024-018',
      name: '中心城区正射影像采集',
      areaName: '北京东城测区',
      areaPolygon: polygonA,
      purpose: '正射',
      droneModel: 'Mavic 3E',
      cameraModel: 'DJI 4/3 CMOS 20MP',
      sensorWidth: 17.3,
      sensorHeight: 13,
      focalLength: 12.29,
      pixelSize: 3.3,
      flightDate: '2024-09-12',
      pilot: '穆清和',
      status: '已飞行',
      currentVersion: 1,
      archiveVersion: 0,
      createdAt: now - 30 * day,
    },
    {
      id: missionB,
      missionNo: 'DM-2024-021',
      name: '滨江带状倾斜摄影',
      areaName: '上海浦东滨江带',
      areaPolygon: polygonB,
      purpose: '带状',
      droneModel: 'M300 RTK',
      cameraModel: 'Zenmuse P1',
      sensorWidth: 35.9,
      sensorHeight: 24,
      focalLength: 35,
      pixelSize: 4.4,
      flightDate: '2024-09-20',
      pilot: '纪长风',
      status: '待飞行',
      currentVersion: 1,
      archiveVersion: 0,
      createdAt: now - 8 * day,
    },
  ];

  const waypoints: Waypoint[] = [];
  // 示范任务 A：4 个航点形成一条覆盖测区的折线
  const wpsA: [number, number][] = [
    [116.3912, 39.9075],
    [116.3978, 39.9075],
    [116.3978, 39.9032],
    [116.3912, 39.9032],
  ];
  wpsA.forEach(([lng, lat], index) => {
    waypoints.push({
      id: newId('wp'),
      missionId: missionA,
      seq: index + 1,
      lng,
      lat,
      altitude: 120,
      speed: 8,
      heading: 90,
      gimbalPitch: -90,
      action: index === wpsA.length - 1 ? '悬停' : '拍照',
      hoverSec: index === wpsA.length - 1 ? 5 : 0,
    });
  });
  waypoints.push({
    id: newId('wp'),
    missionId: missionB,
    seq: 1,
    lng: 121.4726,
    lat: 31.2321,
    altitude: 150,
    speed: 10,
    heading: 45,
    gimbalPitch: -60,
    action: '拍照',
    hoverSec: 0,
  });

  const lines: FlightLine[] = [
    {
      id: newId('line'),
      missionId: missionA,
      lineNo: 1,
      spacing: 62.5,
      photoInterval: 24.8,
      overlapForward: 75,
      overlapSide: 70,
      gsd: 3.22,
      estPhotos: 12,
      estDuration: 3.6,
      batteryCount: 1,
      heading: 90,
      updatedAt: now - 30 * day,
    },
    {
      id: newId('line'),
      missionId: missionB,
      lineNo: 1,
      spacing: 92.3,
      photoInterval: 42.1,
      overlapForward: 70,
      overlapSide: 65,
      gsd: 1.89,
      estPhotos: 9,
      estDuration: 4.2,
      batteryCount: 1,
      heading: 45,
      updatedAt: now - 8 * day,
    },
  ];

  const assets: ImageAsset[] = [];
  const thumbs: AssetThumb[] = [];
  const qualities: ImageAsset['quality'][] = ['合格', '合格', '模糊', '合格', '过曝', '合格'];
  qualities.forEach((quality, index) => {
    const id = newId('asset');
    const lng = 116.3916 + index * 0.0012;
    const lat = 39.9071 - (index % 2) * 0.0009;
    assets.push({
      id,
      missionId: missionA,
      imageNo: `IMG_${String(1001 + index)}`,
      lng,
      lat,
      altitude: 120,
      gsd: 3.22,
      overlap: 76 - index,
      tiltAngle: 2 + index,
      shotAt: now - 30 * day + index * 12000,
      quality,
      folder: `/DM-2024-018/100MEDIA`,
    });
    thumbs.push({ id, missionId: missionA, dataUrl: makeThumbDataUrl(`IMG_${1001 + index}`, quality, lng, lat) });
  });

  const presets: CameraPreset[] = [
    {
      id: newId('preset'),
      name: 'Mavic 3E 广角',
      cameraModel: 'DJI 4/3 CMOS 20MP',
      sensorWidth: 17.3,
      sensorHeight: 13,
      focalLength: 12.29,
      pixelSize: 3.3,
    },
    {
      id: newId('preset'),
      name: 'Zenmuse P1 35mm',
      cameraModel: 'Zenmuse P1',
      sensorWidth: 35.9,
      sensorHeight: 24,
      focalLength: 35,
      pixelSize: 4.4,
    },
    {
      id: newId('preset'),
      name: 'Phantom 4 RTK',
      cameraModel: 'FC6310R',
      sensorWidth: 13.2,
      sensorHeight: 8.8,
      focalLength: 8.8,
      pixelSize: 2.4,
    },
  ];

  // 为示范任务生成初始方案版本快照
  const schemes: SchemeVersion[] = missions.map((mission) => {
    const mWps = waypoints.filter((w) => w.missionId === mission.id).sort((a, b) => a.seq - b.seq);
    const mLine = lines.find((l) => l.missionId === mission.id);
    return {
      id: newId('scheme'),
      missionId: mission.id,
      versionNo: 1,
      waypoints: mWps.map((wp) => ({
        seq: wp.seq,
        lng: wp.lng,
        lat: wp.lat,
        altitude: wp.altitude,
        speed: wp.speed,
        heading: wp.heading,
        gimbalPitch: wp.gimbalPitch,
        action: wp.action,
        hoverSec: wp.hoverSec,
      })),
      camera: {
        cameraModel: mission.cameraModel,
        sensorWidth: mission.sensorWidth,
        sensorHeight: mission.sensorHeight,
        focalLength: mission.focalLength,
        pixelSize: mission.pixelSize,
      },
      line: mLine
        ? {
            spacing: mLine.spacing,
            photoInterval: mLine.photoInterval,
            overlapForward: mLine.overlapForward,
            overlapSide: mLine.overlapSide,
            gsd: mLine.gsd,
            estPhotos: mLine.estPhotos,
            estDuration: mLine.estDuration,
            batteryCount: mLine.batteryCount,
            heading: mLine.heading,
          }
        : {
            spacing: 0,
            photoInterval: 0,
            overlapForward: 75,
            overlapSide: 70,
            gsd: 0,
            estPhotos: 0,
            estDuration: 0,
            batteryCount: 1,
            heading: 90,
          },
      sorties: mLine
        ? splitSorties(mLine).map((s) => ({ sortieNo: s.sortie, photos: s.photos, durationMin: s.durationMin }))
        : [],
      createdAt: mission.createdAt,
      archiveVersion: 0,
    };
  });

  // 七张表超过 Dexie 位置参数上限，改用数组形式声明事务范围
  await db.transaction('rw', [db.missions, db.waypoints, db.lines, db.assets, db.thumbs, db.presets, db.schemes], async () => {
    await db.missions.bulkPut(missions);
    await db.waypoints.bulkPut(waypoints);
    await db.lines.bulkPut(lines);
    await db.assets.bulkPut(assets);
    await db.thumbs.bulkPut(thumbs);
    await db.presets.bulkPut(presets);
    await db.schemes.bulkPut(schemes);
  });
}
