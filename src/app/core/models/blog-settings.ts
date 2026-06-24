export interface BlogSettings {
  title: string;
  tagline: string;
  primaryColor: string;
  accentColor: string;
  bgColor: string;
  cardBgColor: string;
  textColor: string;
  fontFamily: 'Outfit' | 'Space Grotesk' | 'Fira Code' | 'system-ui';
  layoutType: 'grid' | 'list' | 'magazine';
  bannerUrl: string;
  sponsorBannerUrl1?: string;
  sponsorBannerLink1?: string;
  sponsorBannerUrl2?: string;
  sponsorBannerLink2?: string;
  sections?: string[];
}
