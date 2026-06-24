import { Injectable, inject } from '@angular/core';
import Swal from 'sweetalert2';
import { User, Article, LeilaoDia, ConfiguracaoHolofote, GamificationLog } from '../models/interfaces';
import { Firestore, doc, runTransaction } from '@angular/fire/firestore';

@Injectable({
  providedIn: 'root'
})
export class AuctionService {
  private readonly firestore = inject(Firestore);

  async checkLazyConsolidation(spotlight: ConfiguracaoHolofote) {
    if (typeof window === 'undefined') return;
    const todayStr = new Date().toISOString().split('T')[0];
    if (spotlight.dataDestaque < todayStr) {
      const yesterdayStr = spotlight.dataDestaque;
      console.log(`[Spotlight] Fechamento automático pendente detectado para: ${yesterdayStr}. Consolidando...`);
      await this.consolidarLeilaoDia(yesterdayStr);
    }
  }

  async placeBid(articleId: string, amount: number, user: User): Promise<boolean> {
    const todayStr = new Date().toISOString().split('T')[0];
    const leilaoRef = doc(this.firestore, `leilao_holofote/${todayStr}`);
    const userRef = doc(this.firestore, `users/${user.id}`);
    const articleRef = doc(this.firestore, `articles/${articleId}`);

    try {
      await runTransaction(this.firestore, async (transaction) => {
        const leilaoDoc = await transaction.get(leilaoRef);
        const userDoc = await transaction.get(userRef);
        const articleDoc = await transaction.get(articleRef);

        if (!userDoc.exists() || !articleDoc.exists()) {
          throw new Error('Usuário ou artigo não encontrado');
        }

        const userData = userDoc.data() as User;
        const articleData = articleDoc.data() as Article;
        const leilaoData = leilaoDoc.exists() ? (leilaoDoc.data() as LeilaoDia) : {
          id: todayStr,
          maiorLanceAtual: 0,
          usuarioLiderId: '',
          usuarioLiderDisplayName: '',
          postLiderId: '',
          postLiderTitle: '',
          finalizado: false,
          historicoLances: []
        };

        if (leilaoData.finalizado) {
          throw new Error('O leilão de hoje já foi encerrado');
        }

        const currentHighest = leilaoData.maiorLanceAtual;
        const minRequired = currentHighest === 0 ? 10 : currentHighest + 10;
        if (amount < minRequired) {
          throw new Error(`O lance mínimo exigido é ${minRequired} Bits`);
        }

        let userBalance = userData.bits_balance || 0;
        const isAlreadyLeader = leilaoData.usuarioLiderId === user.id;
        
        if (isAlreadyLeader) {
          userBalance += leilaoData.maiorLanceAtual;
        }

        if (userBalance < amount) {
          throw new Error(`Saldo insuficiente de Bits. Você possui ${userBalance} Bits disponíveis.`);
        }

        if (leilaoData.usuarioLiderId && !isAlreadyLeader) {
          const prevLeaderRef = doc(this.firestore, `users/${leilaoData.usuarioLiderId}`);
          const prevLeaderSnap = await transaction.get(prevLeaderRef);
          if (prevLeaderSnap.exists()) {
            const prevLeaderData = prevLeaderSnap.data() as User;
            transaction.update(prevLeaderRef, {
              bits_balance: (prevLeaderData.bits_balance || 0) + leilaoData.maiorLanceAtual
            });
          }
        }

        transaction.update(userRef, {
          bits_balance: userBalance - amount
        });

        const newHistory = [
          ...leilaoData.historicoLances,
          {
            usuarioId: user.id,
            displayName: user.displayName,
            postId: articleId,
            amount: amount,
            timestamp: new Date().toISOString()
          }
        ];

        transaction.set(leilaoRef, {
          id: todayStr,
          maiorLanceAtual: amount,
          usuarioLiderId: user.id,
          usuarioLiderDisplayName: user.displayName,
          postLiderId: articleId,
          postLiderTitle: articleData.title,
          finalizado: false,
          historicoLances: newHistory
        });
      });

      Swal.fire({
        icon: 'success',
        title: '⚡ LANCE CONFIRMADO!',
        html: `Seu lance de <b style="color: #ffd700;">${amount} Bits</b> foi enviado com sucesso e você lidera o Holofote!`,
        background: '#121420',
        color: '#f1f5f9',
        timer: 3000,
        showConfirmButton: false,
        toast: true,
        position: 'top-end'
      });
      return true;
    } catch (err: any) {
      console.error('Erro ao enviar lance:', err);
      Swal.fire({
        icon: 'error',
        title: 'Lance Não Efetuado',
        text: err.message || 'Erro transacional ao registrar lance.',
        background: '#121420',
        color: '#f1f5f9',
        confirmButtonText: 'Entendido',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          confirmButton: 'guiik-swal-confirm-btn'
        },
        buttonsStyling: false
      });
      return false;
    }
  }

  async consolidarLeilaoDia(dataOntem: string): Promise<boolean> {
    const leilaoRef = doc(this.firestore, `leilao_holofote/${dataOntem}`);
    const spotlightRef = doc(this.firestore, 'configuracoes/feed_spotlight');
    const todayStr = new Date().toISOString().split('T')[0];

    try {
      await runTransaction(this.firestore, async (transaction) => {
        const leilaoSnap = await transaction.get(leilaoRef);

        if (!leilaoSnap.exists()) {
          transaction.set(spotlightRef, {
            id: 'feed_spotlight',
            postDestaqueId: '',
            autorUsername: '',
            maiorLanceVencedor: 0,
            dataDestaque: todayStr
          }, { merge: true });
          return;
        }

        const leilaoData = leilaoSnap.data() as LeilaoDia;
        if (leilaoData.finalizado) {
          return;
        }

        let winnerUsername = '';
        if (leilaoData.usuarioLiderId) {
          const winnerRef = doc(this.firestore, `users/${leilaoData.usuarioLiderId}`);
          const winnerSnap = await transaction.get(winnerRef);
          const winnerData = winnerSnap.exists() ? (winnerSnap.data() as User) : null;
          winnerUsername = winnerData ? winnerData.username : '';
        }

        transaction.update(leilaoRef, { finalizado: true });

        if (leilaoData.usuarioLiderId) {
          const logId = 'glog_' + Date.now() + '_burn';
          const logRef = doc(this.firestore, `gamification_logs/${logId}`);
          const burnLog: GamificationLog = {
            id: logId,
            userId: leilaoData.usuarioLiderId,
            typeAction: 'spend',
            amount: leilaoData.maiorLanceAtual,
            description: `Queima de Bits: Venceu o Holofote para a matéria "${leilaoData.postLiderTitle}"`,
            createdAt: new Date().toISOString()
          };
          transaction.set(logRef, burnLog);

          transaction.set(spotlightRef, {
            id: 'feed_spotlight',
            postDestaqueId: leilaoData.postLiderId,
            autorUsername: winnerUsername,
            maiorLanceVencedor: leilaoData.maiorLanceAtual,
            dataDestaque: todayStr
          });
        } else {
          transaction.set(spotlightRef, {
            id: 'feed_spotlight',
            postDestaqueId: '',
            autorUsername: '',
            maiorLanceVencedor: 0,
            dataDestaque: todayStr
          });
        }
      });

      console.log(`[Spotlight] Leilão de ${dataOntem} consolidado com sucesso.`);
      return true;
    } catch (err) {
      console.error('Erro ao consolidar leilão:', err);
      return false;
    }
  }
}
