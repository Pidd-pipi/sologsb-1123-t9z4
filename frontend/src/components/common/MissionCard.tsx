import type { ReactNode } from 'react';
import { Card, Descriptions, Space, Tag, Typography } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import type { Mission } from '../../types/mission';
import type { SchemeConflict } from '../../types/scheme';
import { polygonAreaM2 } from '../../utils/geoCalc';
import { hasAmapKey } from '../../utils/amapLoader';

export interface MissionCardProps {
  mission: Mission;
  waypointCount?: number;
  assetCount?: number;
  lineCount?: number;
  /** 未绑定架次的成果数 */
  unboundCount?: number;
  /** 方案冲突列表 */
  conflicts?: SchemeConflict[];
  onOpen?: (id: string) => void;
  footer?: ReactNode;
}

const STATUS_COLOR: Record<string, string> = {
  规划中: 'default',
  待飞行: 'blue',
  已飞行: 'green',
  已归档: 'purple',
};

/** 任务摘要卡（编号、测区、机型、日期、航点数、方案版本、未绑定成果、冲突），被任务台账、航线规划页消费 */
export default function MissionCard({
  mission,
  waypointCount,
  assetCount,
  lineCount,
  unboundCount = 0,
  conflicts = [],
  onOpen,
  footer,
}: MissionCardProps) {
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
          {mission.currentVersion ? <Tag color="geekblue">方案 v{mission.currentVersion}</Tag> : null}
        </Space>
      }
    >
      <Typography.Paragraph style={{ marginBottom: 6 }} strong>
        {mission.name}
      </Typography.Paragraph>
      <Descriptions size="small" column={2} colon={false}>
        <Descriptions.Item label="测区">{mission.areaName}</Descriptions.Item>
        <Descriptions.Item label="飞行日期">{mission.flightDate}</Descriptions.Item>
        <Descriptions.Item label="机型">{mission.droneModel}</Descriptions.Item>
        <Descriptions.Item label="相机">{mission.cameraModel}</Descriptions.Item>
        <Descriptions.Item label="航点">{waypointCount ?? 0} 个</Descriptions.Item>
        <Descriptions.Item label="航线">{lineCount ?? 0} 条</Descriptions.Item>
        <Descriptions.Item label="成果条目">{assetCount ?? 0} 张</Descriptions.Item>
        <Descriptions.Item label="测区面积">{polygonAreaM2(mission.areaPolygon).toFixed(0)} m²</Descriptions.Item>
        <Descriptions.Item label="飞手">{mission.pilot}</Descriptions.Item>
        <Descriptions.Item label="传感器">
          {mission.sensorWidth}×{mission.sensorHeight} mm / f{mission.focalLength} mm / {mission.pixelSize} μm
        </Descriptions.Item>
      </Descriptions>
      {(unboundCount > 0 || conflicts.length > 0) && (
        <Space size={6} wrap style={{ marginTop: 6 }}>
          {unboundCount > 0 ? (
            <Tag color="orange" icon={<WarningOutlined />}>
              {unboundCount} 张成果未绑定架次
            </Tag>
          ) : null}
          {conflicts.map((c, i) => (
            <Tag key={i} color="red" icon={<WarningOutlined />}>
              {c.message}
            </Tag>
          ))}
        </Space>
      )}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        地图视图：{hasAmapKey() ? '高德 JS API' : '本地 SVG 网格（未配置 VITE_AMAP_KEY）'}
      </Typography.Text>
      {footer ? <div style={{ marginTop: 8 }}>{footer}</div> : null}
    </Card>
  );
}
