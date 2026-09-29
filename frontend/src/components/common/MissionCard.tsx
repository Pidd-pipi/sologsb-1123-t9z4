import type { ReactNode } from 'react';
import { Alert, Card, Descriptions, Space, Tag, Typography } from 'antd';
import type { Mission } from '../../types/mission';
import type { PlanVersion, SortieRecord } from '../../types/planVersion';
import { polygonAreaM2 } from '../../utils/geoCalc';
import { hasAmapKey } from '../../utils/amapLoader';

export interface MissionCardProps {
  mission: Mission;
  waypointCount?: number;
  assetCount?: number;
  lineCount?: number;
  versions?: PlanVersion[];
  currentVersion?: PlanVersion;
  sorties?: SortieRecord[];
  unboundCount?: number;
  onOpen?: (id: string) => void;
  footer?: ReactNode;
}

const STATUS_COLOR: Record<string, string> = {
  规划中: 'default',
  待飞行: 'blue',
  已飞行: 'green',
  已归档: 'purple',
};

/** 任务摘要卡（编号、版本、未绑定影像、冲突与核销状态） */
export default function MissionCard({
  mission,
  waypointCount,
  assetCount,
  lineCount,
  versions = [],
  currentVersion,
  sorties = [],
  unboundCount = 0,
  onOpen,
  footer,
}: MissionCardProps) {
  const unreconciledCount = sorties.filter((s) => s.status !== '已核销').length;
  const frozenCount = versions.filter((v) => v.status !== '草稿').length;
  const hasBlocker = mission.status === '已飞行' && (unboundCount > 0 || unreconciledCount > 0);

  return (
    <Card
      size="small"
      hoverable={!!onOpen}
      onClick={onOpen ? () => onOpen(mission.id) : undefined}
      title={
        <Space size={6} wrap>
          <span data-testid={`mission-card-${mission.missionNo}`}>{mission.missionNo}</span>
          <Tag color={STATUS_COLOR[mission.status]}>{mission.status}</Tag>
          <Tag color="cyan">{mission.purpose}</Tag>
        </Space>
      }
    >
      <Typography.Paragraph style={{ marginBottom: 6 }} strong>
        {mission.name}
      </Typography.Paragraph>
      {mission.archiveConflict ? (
        <Alert
          style={{ marginBottom: 8 }}
          type="error"
          showIcon
          message="版本冲突：另一个标签页已先归档，本页旧结果未覆盖"
        />
      ) : null}
      <Descriptions size="small" column={2} colon={false}>
        <Descriptions.Item label="测区">{mission.areaName}</Descriptions.Item>
        <Descriptions.Item label="飞行日期">{mission.flightDate}</Descriptions.Item>
        <Descriptions.Item label="机型">{mission.droneModel}</Descriptions.Item>
        <Descriptions.Item label="相机">{mission.cameraModel}</Descriptions.Item>
        <Descriptions.Item label="方案版本">
          {currentVersion ? `v${currentVersion.versionNo} · ${currentVersion.status}` : '未冻结'}
          {frozenCount > 1 ? <Tag>共 {frozenCount} 版</Tag> : null}
        </Descriptions.Item>
        <Descriptions.Item label="航点 / 航线">{waypointCount ?? 0} 个 / {lineCount ?? 0} 条</Descriptions.Item>
        <Descriptions.Item label="成果条目">{assetCount ?? 0} 张</Descriptions.Item>
        <Descriptions.Item label="未绑定影像">
          <Tag color={unboundCount > 0 ? 'red' : 'green'}>{unboundCount} 张</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="架次核销">
          <Tag color={unreconciledCount > 0 ? 'orange' : 'green'}>
            {sorties.length - unreconciledCount}/{sorties.length}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="测区面积">{polygonAreaM2(mission.areaPolygon).toFixed(0)} m²</Descriptions.Item>
        <Descriptions.Item label="飞手">{mission.pilot}</Descriptions.Item>
        <Descriptions.Item label="已飞参数" span={2}>
          {currentVersion
            ? `航高 ${currentVersion.route.altitude}m · 重叠 ${currentVersion.route.overlapForward}/${currentVersion.route.overlapSide}% · GSD ${currentVersion.route.gsd}cm/px`
            : '冻结后固定'}
        </Descriptions.Item>
        <Descriptions.Item label="传感器" span={2}>
          {mission.sensorWidth}×{mission.sensorHeight} mm / f{mission.focalLength} mm / {mission.pixelSize} μm
        </Descriptions.Item>
      </Descriptions>
      {hasBlocker ? (
        <Typography.Text type="danger" style={{ fontSize: 12 }}>
          归档前必须绑定全部影像并核销所有架次
        </Typography.Text>
      ) : null}
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
        地图视图：{hasAmapKey() ? '高德 JS API' : '本地 SVG 网格（未配置 VITE_AMAP_KEY）'}
      </Typography.Text>
      {footer ? <div style={{ marginTop: 8 }}>{footer}</div> : null}
    </Card>
  );
}
