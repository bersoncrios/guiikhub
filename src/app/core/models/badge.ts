export interface Badge {
  id: string;
  name: string;
  description: string;
  xpRequirement: number;
  iconUrl: string;
  createdAt: string;
  type?: 'xp' | 'event' | 'special' | 'staff' | 'milestone' | 'custom';
  targetDate?: string;
  rewardBits?: number;
}

