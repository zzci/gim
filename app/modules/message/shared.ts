import { getPowerLevelsContent as getModelPowerLevelsContent } from '@/models/roomState'

export function getRoomId(c: any): string {
  return c.req.param('roomId') || ''
}

export function getPowerLevelsContent(roomId: string): Record<string, any> {
  return getModelPowerLevelsContent(roomId)
}
