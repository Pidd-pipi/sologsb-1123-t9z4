import type { CameraPreset } from './mission';
import type { Waypoint } from './waypoint';

export type PlanVersionStatus = '草稿' | '冻结' | '已飞' | '已替代';
export type SortieStatus = '待飞' | '已核销';

export interface CameraSnapshot {
  cameraModel: string;
  sensorWidth: number;
  sensorHeight: number;
  focalLength: number;
  pixelSize: number;
}

export interface FlightLineSnapshot {
  altitude: number;
  speed: number;
  spacing: number;
  photoInterval: number;
  overlapForward: number;
  overlapSide: number;
  gsd: number;
  estPhotos: number;
  estDuration: number;
  batteryCount: number;
  heading: number;
}

export interface WaypointSnapshot {
  seq: number;
  lng: number;
  lat: number;
  altitude: number;
  speed: number;
  heading: number;
  gimbalPitch: number;
  action: Waypoint['action'];
  hoverSec: number;
}

/** 方案版本：进入待飞行时冻结，之后修改只追加新版本 */
export interface PlanVersion {
  id: string;
  missionId: string;
  versionNo: number;
  status: PlanVersionStatus;
  reason: string;
  camera: CameraSnapshot;
  route: FlightLineSnapshot;
  waypoints: WaypointSnapshot[];
  fingerprint: string;
  createdAt: number;
  frozenAt?: number;
  flownAt?: number;
}

/** 架次核销记录：影像必须绑定到具体架次后才能核销 */
export interface SortieRecord {
  id: string;
  missionId: string;
  planVersionId: string;
  sortieNo: number;
  plannedPhotos: number;
  plannedDurationMin: number;
  status: SortieStatus;
  createdAt: number;
  reconciledAt?: number;
}

export const EMPTY_CAMERA: CameraSnapshot = {
  cameraModel: '',
  sensorWidth: 13.2,
  sensorHeight: 8.8,
  focalLength: 8.8,
  pixelSize: 2.4,
};

export function cameraFromPreset(preset: CameraPreset): CameraSnapshot {
  return {
    cameraModel: preset.cameraModel,
    sensorWidth: preset.sensorWidth,
    sensorHeight: preset.sensorHeight,
    focalLength: preset.focalLength,
    pixelSize: preset.pixelSize,
  };
}
