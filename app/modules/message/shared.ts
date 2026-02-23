import { getPowerLevelsContent as getModelPowerLevelsContent } from '@/models/roomState'

export function getRoomId(c: any): string {
  return c.req.param('roomId') || ''
}

export async function getPowerLevelsContent(roomId: string): Promise<Record<string, any>> {
  return getModelPowerLevelsContent(roomId)
}
