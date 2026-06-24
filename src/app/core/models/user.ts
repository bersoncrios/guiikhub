import { BlogSettings } from './blog-settings';

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  bio: string;
  email?: string;
  bannerUrl?: string;
  blogSettings: BlogSettings;
  viewsCount?: number;
  collaborators?: string[];
  bits_balance?: number;
  xp_points?: number;
  lastDailyRewardAt?: string;
  role?: 'admin' | 'creator';
  unlockedBadges?: string[];
}
