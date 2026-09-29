/** 航点快照（冻结时的航点数据，不可变） */
export interface WaypointSnapshot {
  seq: number;
  lng: number;
  lat: number;
  altitude: number;
  speed: number;
  heading: number;
  gimbalPitch: number;
  action: string;
  hoverSec: number;
}

/** 相机参数快照 */
export interface CameraSnapshot {
  cameraModel: string;
  sensorWidth: number;
  sensorHeight: number;
  focalLength: number;
  pixelSize: number;
}

/** 航线参数快照 */
export interface LineSnapshot {
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

/** 架次（按电池续航拆分） */
export interface Sortie {
  sortieNo: number;
  photos: number;
  durationMin: number;
}

/** 方案版本（冻结快照，不可变） */
export interface SchemeVersion {
  id: string;
  missionId: string;
  /** 版本号，从 1 递增 */
  versionNo: number;
  waypoints: WaypointSnapshot[];
  camera: CameraSnapshot;
  line: LineSnapshot;
  sorties: Sortie[];
  createdAt: number;
  /** 归档乐观锁版本号 */
  archiveVersion: number;
  /** 归档时间 */
  archivedAt?: number;
}

/** 方案冲突类型 */
export type SchemeConflictType = 'scheme_modified' | 'archive_concurrent';

export interface SchemeConflict {
  type: SchemeConflictType;
  message: string;
}
