export interface LeilaoDia {
  id: string; // YYYY-MM-DD
  maiorLanceAtual: number;
  usuarioLiderId: string;
  usuarioLiderDisplayName: string;
  postLiderId: string;
  postLiderTitle: string;
  finalizado: boolean;
  historicoLances: Array<{
    usuarioId: string;
    displayName: string;
    postId: string;
    amount: number;
    timestamp: string;
  }>;
}
