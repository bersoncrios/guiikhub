export interface ShopItem {
  id: string;
  name: string;
  description: string;
  cost: number;
  category: 'frame' | 'tag' | 'theme' | 'other';
  imageUrl?: string;
  itemValue: string; // The CSS class name, status tag text, or code value
  createdAt: string;
}
