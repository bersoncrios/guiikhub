export interface GamificationLog {
  id: string;
  userId: string;
  typeAction: 'earn' | 'spend' | 'transfer';
  amount: number;
  description: string;
  createdAt: string;
}
