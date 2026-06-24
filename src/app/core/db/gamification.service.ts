import { Injectable, inject } from '@angular/core';
import Swal from 'sweetalert2';
import { User, Article, GamificationLog, Badge } from '../models/interfaces';
import { Firestore, doc, getDoc, updateDoc, deleteDoc, setDoc, runTransaction, collection, getDocs } from '@angular/fire/firestore';

@Injectable({
  providedIn: 'root'
})
export class GamificationService {
  private readonly firestore = inject(Firestore);

  async handleUserRewardOrSpend(
    userId: string,
    amount: number,
    actionType: 'earn' | 'spend' | 'transfer',
    description: string,
    badgesList: Badge[],
    currentUser: User | null
  ): Promise<boolean> {
    try {
      const userRef = doc(this.firestore, `users/${userId}`);
      const logId = 'glog_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const logRef = doc(this.firestore, `gamification_logs/${logId}`);

      await runTransaction(this.firestore, async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists()) {
          throw new Error('Usuário não encontrado');
        }

        const userData = userDoc.data() as User;
        const currentBalance = userData.bits_balance || 0;
        const currentXp = userData.xp_points || 0;

        let newBalance = currentBalance;
        let newXp = currentXp;

        if (actionType === 'earn') {
          newBalance += amount;
          newXp += amount;
        } else if (actionType === 'spend') {
          if (currentBalance < amount) {
            throw new Error('Saldo insuficiente de bits');
          }
          newBalance -= amount;
        } else if (actionType === 'transfer') {
          if (amount < 0) {
            const absAmount = Math.abs(amount);
            if (currentBalance < absAmount) {
              throw new Error('Saldo insuficiente para transferência');
            }
            newBalance -= absAmount;
          } else {
            newBalance += amount;
          }
        }

        transaction.update(userRef, {
          bits_balance: newBalance,
          xp_points: newXp
        });

        let unlockedBadgesText = '';
        if (newXp !== currentXp) {
          const badgeResult = this.checkAndUnlockBadgesInTransaction(userData, newXp, transaction, userRef, badgesList, currentUser);
          unlockedBadgesText = badgeResult.unlockedBadgesText;
        }

        const newLog: GamificationLog = {
          id: logId,
          userId,
          typeAction: actionType,
          amount,
          description: description + (unlockedBadgesText ? `. Conquistas desbloqueadas: ${unlockedBadgesText}` : ''),
          createdAt: new Date().toISOString()
        };
        transaction.set(logRef, newLog);
      });

      return true;
    } catch (err: any) {
      console.error('Erro na transação de gamificação:', err);
      Swal.fire({
        icon: 'error',
        title: 'Operação Neural Falhou',
        text: err.message || 'Erro ao processar transação de gamificação.',
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

  async runGamificationMigration(usersList: User[], badgesList: Badge[]): Promise<void> {
    for (const u of usersList) {
      const currentXp = u.xp_points ?? 0;
      const currentBits = u.bits_balance ?? 0;
      const unlocked = u.unlockedBadges || [];
      const eligibleBadges = badgesList.filter(b => (!b.type || b.type === 'xp') && b.xpRequirement <= currentXp && !unlocked.includes(b.id));

      const updates: any = {};
      let needsUpdate = false;

      if (u.bits_balance === undefined || u.xp_points === undefined) {
        updates.bits_balance = currentBits;
        updates.xp_points = currentXp;
        needsUpdate = true;
      }

      if (eligibleBadges.length > 0) {
        const newUnlocked = [...unlocked, ...eligibleBadges.map(b => b.id)];
        updates.unlockedBadges = newUnlocked;
        needsUpdate = true;
      }

      if (needsUpdate) {
        const userRef = doc(this.firestore, `users/${u.id}`);
        await updateDoc(userRef, updates);
      }
    }
  }  async claimDailyReward(userId: string, todayStr: string, badgesList: Badge[], currentUser: User | null): Promise<boolean> {
    try {
      const userRef = doc(this.firestore, `users/${userId}`);
      const logId = 'glog_' + Date.now() + '_daily';
      const logRef = doc(this.firestore, `gamification_logs/${logId}`);

      let activeBadges = badgesList || [];
      if (activeBadges.length === 0) {
        const badgesCol = collection(this.firestore, 'badges');
        const badgesSnap = await getDocs(badgesCol);
        activeBadges = badgesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Badge));
      }

      await runTransaction(this.firestore, async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists()) {
          throw new Error('Usuário não encontrado');
        }

        const userData = userDoc.data() as User;
        if (userData.lastDailyRewardAt === todayStr) {
          return;
        }

        const currentBalance = userData.bits_balance || 0;
        const currentXp = userData.xp_points || 0;
        const newXp = currentXp + 10;
        const unlocked = userData.unlockedBadges || [];
        const newUnlocked = [...unlocked];

        // Auto-assign event badges matching today's date
        const eventBadgesForToday = activeBadges.filter(b => 
          b.type === 'event' && b.targetDate === todayStr && !unlocked.includes(b.id)
        );

        let eventLogsText = '';
        if (eventBadgesForToday.length > 0) {
          eventBadgesForToday.forEach(b => {
            newUnlocked.push(b.id);
            if (eventLogsText) eventLogsText += ', ';
            eventLogsText += b.name;
          });
        }
        
        transaction.update(userRef, {
          bits_balance: currentBalance + 10,
          xp_points: newXp,
          unlockedBadges: newUnlocked,
          lastDailyRewardAt: todayStr
        });

        // Also check regular XP badges
        this.checkAndUnlockBadgesInTransaction(
          { ...userData, unlockedBadges: newUnlocked }, 
          newXp, 
          transaction, 
          userRef, 
          activeBadges, 
          currentUser
        );

        const rewardLog: GamificationLog = {
          id: logId,
          userId,
          typeAction: 'earn',
          amount: 10,
          description: 'Recompensa de Login Diário GuiikHub' + (eventLogsText ? `. Emblemas de evento desbloqueados: ${eventLogsText}` : ''),
          createdAt: new Date().toISOString()
        };
        transaction.set(logRef, rewardLog);
      });

      // Show daily bonus success toast
      Swal.fire({
        icon: 'success',
        title: '⚡ BÔNUS DIÁRIO RECEBIDO!',
        html: `Você ganhou <b style="color: #ffd700;">+10 Bits</b> e <b style="color: #00f0ff;">+10 XP</b> por entrar hoje no GuiikHub!`,
        background: '#121420',
        color: '#f1f5f9',
        timer: 3000,
        showConfirmButton: false,
        toast: true,
        position: 'top-end',
        customClass: {
          popup: 'guiik-swal-toast-popup'
        }
      });

      // Show event badges alerts if any were newly unlocked
      const currentUserUnlocked = currentUser?.unlockedBadges || [];
      const newlyUnlockedEvents = activeBadges.filter(b => 
        b.type === 'event' && b.targetDate === todayStr && !currentUserUnlocked.includes(b.id)
      );

      if (newlyUnlockedEvents.length > 0 && currentUser && userId === currentUser.id) {
        setTimeout(() => {
          newlyUnlockedEvents.forEach(badge => {
            Swal.fire({
              title: '🎁 EMBLEMA DE EVENTO!',
              text: `Por logar hoje, você desbloqueou o emblema especial: ${badge.name}!`,
              imageUrl: badge.iconUrl || '/images/default-badge.png',
              imageWidth: 100,
              imageHeight: 100,
              imageAlt: badge.name,
              background: '#121420',
              color: '#f1f5f9',
              confirmButtonText: 'Sensacional!',
              customClass: {
                popup: 'guiik-swal-popup',
                title: 'guiik-swal-title',
                confirmButton: 'guiik-swal-confirm-btn'
              },
              buttonsStyling: false
            });
          });
        }, 3500);
      }

      return true;
    } catch (err) {
      console.error('Erro ao conceder bônus diário:', err);
      return false;
    }
  }

  async applaudArticle(
    articleId: string,
    authorId: string,
    amount: number,
    user: User,
    gamificationLogsList: GamificationLog[],
    badgesList: Badge[]
  ): Promise<boolean> {
    if (user.id === authorId) {
      Swal.fire({
        icon: 'warning',
        title: 'Auto-Aplauso Bloqueado',
        text: 'Você não pode gastar Bits aplaudindo seu próprio artigo!',
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

    try {
      const readerRef = doc(this.firestore, `users/${user.id}`);
      const authorRef = doc(this.firestore, `users/${authorId}`);
      const articleRef = doc(this.firestore, `articles/${articleId}`);
      
      const logIdReader = 'glog_' + Date.now() + '_clap_spend';
      const logIdAuthor = 'glog_' + Date.now() + '_clap_earn';
      
      const logReaderRef = doc(this.firestore, `gamification_logs/${logIdReader}`);
      const logAuthorRef = doc(this.firestore, `gamification_logs/${logIdAuthor}`);

      await runTransaction(this.firestore, async (transaction) => {
        const readerDoc = await transaction.get(readerRef);
        const authorDoc = await transaction.get(authorRef);
        const articleDoc = await transaction.get(articleRef);

        if (!readerDoc.exists() || !authorDoc.exists() || !articleDoc.exists()) {
          throw new Error('Leitor, autor ou artigo não encontrado');
        }

        const readerData = readerDoc.data() as User;
        const authorData = authorDoc.data() as User;
        const articleData = articleDoc.data() as Article;

        const readerBalance = readerData.bits_balance || 0;
        if (readerBalance < amount) {
          throw new Error('Saldo de Bits insuficiente');
        }

        const clapsGiven = gamificationLogsList
          .filter(log => log.typeAction === 'spend' && log.description === `Aplaudiu o artigo "${articleData.title}"`)
          .reduce((sum, log) => sum + log.amount, 0);

        if (clapsGiven + amount > 5) {
          throw new Error('Limite de 5 aplausos por artigo excedido');
        }

        transaction.update(readerRef, {
          bits_balance: readerBalance - amount
        });

        const authorBalance = authorData.bits_balance || 0;
        const authorXp = authorData.xp_points || 0;
        const newXp = authorXp + amount;
        transaction.update(authorRef, {
          bits_balance: authorBalance + amount,
          xp_points: newXp
        });

        this.checkAndUnlockBadgesInTransaction(authorData, newXp, transaction, authorRef, badgesList, user);

        const currentClaps = articleData.applauseCount || 0;
        transaction.update(articleRef, {
          applauseCount: currentClaps + amount
        });

        const readerLog: GamificationLog = {
          id: logIdReader,
          userId: user.id,
          typeAction: 'spend',
          amount: amount,
          description: `Aplaudiu o artigo "${articleData.title}"`,
          createdAt: new Date().toISOString()
        };

        const authorLog: GamificationLog = {
          id: logIdAuthor,
          userId: authorId,
          typeAction: 'earn',
          amount: amount,
          description: `Recebeu aplausos no artigo "${articleData.title}"`,
          createdAt: new Date().toISOString()
        };

        transaction.set(logReaderRef, readerLog);
        transaction.set(logAuthorRef, authorLog);
      });

      return true;
    } catch (err: any) {
      console.error('Erro ao processar aplausos:', err);
      Swal.fire({
        icon: 'error',
        title: 'Falha ao Aplaudir',
        text: err.message || 'Erro transacional ao transferir Bits.',
        background: '#121420',
        color: '#f1f5f9',
        confirmButtonText: 'OK',
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

  async addXpToUser(
    userId: string, 
    xpAmount: number, 
    reason: string, 
    badgesList: Badge[], 
    currentUser: User | null
  ): Promise<boolean> {
    try {
      const userRef = doc(this.firestore, `users/${userId}`);
      const logId = 'glog_' + Date.now() + '_xp_' + Math.random().toString(36).substring(2, 7);
      const logRef = doc(this.firestore, `gamification_logs/${logId}`);

      await runTransaction(this.firestore, async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists()) {
          throw new Error('Usuário não encontrado');
        }

        const userData = userDoc.data() as User;
        const currentXp = userData.xp_points || 0;
        const newXp = currentXp + xpAmount;
        
        const badgeResult = this.checkAndUnlockBadgesInTransaction(userData, newXp, transaction, userRef, badgesList, currentUser);
        const newUnlockedBadgesText = badgeResult.unlockedBadgesText;

        const updates: any = {
          xp_points: newXp
        };
        if (badgeResult.rewardBits > 0) {
          updates.bits_balance = (userData.bits_balance || 0) + badgeResult.rewardBits;
        }

        transaction.update(userRef, updates);

        const xpLog: GamificationLog = {
          id: logId,
          userId,
          typeAction: 'earn',
          amount: xpAmount,
          description: `Ganhou ${xpAmount} XP por: ${reason}` + (newUnlockedBadgesText ? `. Conquistas desbloqueadas: ${newUnlockedBadgesText}` : ''),
          createdAt: new Date().toISOString()
        };
        transaction.set(logRef, xpLog);
      });

      return true;
    } catch (err) {
      console.error('Erro ao adicionar XP:', err);
      return false;
    }
  }

  private checkAndUnlockBadgesInTransaction(
    userData: User,
    newXp: number,
    transaction: any,
    userRef: any,
    badgesList: Badge[],
    currentUser: User | null
  ): { unlockedBadgesText: string; newUnlocked: string[]; rewardBits: number } {
    const unlocked = userData.unlockedBadges || [];
    const newUnlocked = [...unlocked];
    const eligibleBadges = badgesList.filter(b => (!b.type || b.type === 'xp') && b.xpRequirement <= newXp && !unlocked.includes(b.id));
    
    let unlockedBadgesText = '';
    let rewardBits = 0;
    if (eligibleBadges.length > 0) {
      eligibleBadges.forEach(b => {
        if (!newUnlocked.includes(b.id)) {
          newUnlocked.push(b.id);
          if (unlockedBadgesText) unlockedBadgesText += ', ';
          unlockedBadgesText += b.name;
          rewardBits += b.rewardBits || 0;
        }
      });
      transaction.update(userRef, {
        unlockedBadges: newUnlocked
      });
      
      if (currentUser && userData.id === currentUser.id) {
        setTimeout(() => {
          eligibleBadges.forEach(badge => {
            const bitsText = badge.rewardBits ? ` e ganhou +${badge.rewardBits} Bits` : '';
            Swal.fire({
              title: '🏆 NOVO EMBLEMA DESBLOQUEADO!',
              text: `Parabéns! Você alcançou o marco de ${badge.xpRequirement} XP e ganhou o emblema: ${badge.name}${bitsText}!`,
              imageUrl: badge.iconUrl || '/images/default-badge.png',
              imageWidth: 100,
              imageHeight: 100,
              imageAlt: badge.name,
              background: '#121420',
              color: '#f1f5f9',
              confirmButtonText: 'Sensacional!',
              customClass: {
                popup: 'guiik-swal-popup',
                title: 'guiik-swal-title',
                confirmButton: 'guiik-swal-confirm-btn'
              },
              buttonsStyling: false
            });
          });
        }, 500);
      }
    }
    return { unlockedBadgesText, newUnlocked, rewardBits };
  }

  async unlockBadgesRetroactively(userId: string, badgesToUnlock: Badge[], currentUser: User | null): Promise<void> {
    try {
      const userRef = doc(this.firestore, `users/${userId}`);
      const logId = 'glog_' + Date.now() + '_retro_' + Math.random().toString(36).substring(2, 7);
      const logRef = doc(this.firestore, `gamification_logs/${logId}`);

      await runTransaction(this.firestore, async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists()) return;

        const userData = userDoc.data() as User;
        const unlocked = userData.unlockedBadges || [];
        const newUnlocked = [...unlocked];
        
        let newUnlockedBadgesText = '';
        let rewardBits = 0;
        badgesToUnlock.forEach(b => {
          if (!newUnlocked.includes(b.id)) {
            newUnlocked.push(b.id);
            if (newUnlockedBadgesText) newUnlockedBadgesText += ', ';
            newUnlockedBadgesText += b.name;
            rewardBits += b.rewardBits || 0;
          }
        });

        if (newUnlockedBadgesText) {
          const updates: any = { unlockedBadges: newUnlocked };
          if (rewardBits > 0) {
            updates.bits_balance = (userData.bits_balance || 0) + rewardBits;
          }
          transaction.update(userRef, updates);

          const xpLog: GamificationLog = {
            id: logId,
            userId,
            typeAction: 'earn',
            amount: 0,
            description: `Desbloqueou conquistas retroativamente: ${newUnlockedBadgesText}` + (rewardBits > 0 ? ` (+${rewardBits} Bits)` : ''),
            createdAt: new Date().toISOString()
          };
          transaction.set(logRef, xpLog);
          
          if (currentUser && userId === currentUser.id) {
            setTimeout(() => {
              badgesToUnlock.forEach(badge => {
                const bitsText = badge.rewardBits ? ` e ganhou +${badge.rewardBits} Bits` : '';
                Swal.fire({
                  title: '🏆 NOVO EMBLEMA DESBLOQUEADO!',
                  text: `Parabéns! Você alcançou o marco de ${badge.xpRequirement} XP e ganhou o emblema: ${badge.name}${bitsText}!`,
                  imageUrl: badge.iconUrl || '/images/default-badge.png',
                  imageWidth: 100,
                  imageHeight: 100,
                  imageAlt: badge.name,
                  background: '#121420',
                  color: '#f1f5f9',
                  confirmButtonText: 'Sensacional!',
                  customClass: {
                    popup: 'guiik-swal-popup',
                    title: 'guiik-swal-title',
                    confirmButton: 'guiik-swal-confirm-btn'
                  },
                  buttonsStyling: false
                });
              });
            }, 500);
          }
        }
      });
    } catch (err) {
      console.error('Erro ao desbloquear emblemas retroativamente:', err);
    }
  }

  async createBadge(
    name: string, 
    description: string, 
    xpRequirement: number, 
    iconUrl: string,
    type?: 'xp' | 'event' | 'special' | 'staff' | 'milestone' | 'custom',
    targetDate?: string,
    rewardBits?: number
  ): Promise<boolean> {
    try {
      const id = 'badge_' + Date.now();
      const newBadge: Badge = {
        id,
        name,
        description,
        xpRequirement,
        iconUrl: iconUrl || '/images/default-badge.png',
        type: type || 'xp',
        targetDate: targetDate || '',
        rewardBits: rewardBits || 0,
        createdAt: new Date().toISOString()
      };
      await setDoc(doc(this.firestore, `badges/${id}`), newBadge);
      
      Swal.fire({
        icon: 'success',
        title: 'Emblema Criado!',
        text: `O emblema "${name}" foi cadastrado no sistema com sucesso.`,
        background: '#121420',
        color: '#f1f5f9'
      });
      return true;
    } catch (err) {
      console.error('Erro ao criar emblema:', err);
      Swal.fire('Erro', 'Não foi possível cadastrar o emblema.', 'error');
      return false;
    }
  }

  async deleteBadge(badgeId: string): Promise<boolean> {
    try {
      await deleteDoc(doc(this.firestore, `badges/${badgeId}`));
      Swal.fire({
        icon: 'success',
        title: 'Emblema Excluído',
        text: 'O emblema foi removido do sistema.',
        background: '#121420',
        color: '#f1f5f9'
      });
      return true;
    } catch (err) {
      console.error('Erro ao excluir emblema:', err);
      Swal.fire('Erro', 'Não foi possível excluir o emblema.', 'error');
      return false;
    }
  }

  async grantBitsToUser(targetUserId: string, amount: number, description: string, badgesList: Badge[], currentUser: User | null): Promise<boolean> {
    try {
      const userRef = doc(this.firestore, `users/${targetUserId}`);
      const logId = 'glog_' + Date.now() + '_grant';
      const logRef = doc(this.firestore, `gamification_logs/${logId}`);

      await runTransaction(this.firestore, async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists()) {
          throw new Error('Usuário não encontrado');
        }

        const userData = userDoc.data() as User;
        const currentBalance = userData.bits_balance || 0;
        const currentXp = userData.xp_points || 0;
        const newXp = Math.max(0, currentXp + (amount > 0 ? amount : 0));

        transaction.update(userRef, {
          bits_balance: Math.max(0, currentBalance + amount),
          xp_points: newXp
        });

        this.checkAndUnlockBadgesInTransaction(userData, newXp, transaction, userRef, badgesList, currentUser);

        const grantLog: GamificationLog = {
          id: logId,
          userId: targetUserId,
          typeAction: amount >= 0 ? 'earn' : 'spend',
          amount: Math.abs(amount),
          description: description || 'Ajuste administrativo de saldo',
          createdAt: new Date().toISOString()
        };
        transaction.set(logRef, grantLog);
      });

      return true;
    } catch (err) {
      console.error('Erro ao conceder bits:', err);
      return false;
    }
  }

  async rewardPostReading(
    articleId: string, 
    articleTitle: string,
    user: User,
    articlesList: Article[],
    gamificationLogsList: GamificationLog[],
    rewardedArticlesInMemory: Set<string>,
    badgesList: Badge[]
  ): Promise<boolean> {
    const art = articlesList.find(a => a.id === articleId);
    if (art && art.authorId === user.id) {
      return false;
    }

    if (rewardedArticlesInMemory.has(articleId)) {
      return false;
    }

    const alreadyRewarded = gamificationLogsList.some(
      log => log.typeAction === 'earn' && log.description.includes(`Leitura completa do artigo: ${articleId}`)
    );

    if (alreadyRewarded) {
      rewardedArticlesInMemory.add(articleId);
      return false;
    }

    rewardedArticlesInMemory.add(articleId);
    const success = await this.addXpToUser(user.id, 5, `Leitura completa do artigo: ${articleId}`, badgesList, user);
    if (success) {
      Swal.fire({
        icon: 'success',
        title: '⚡ CONHECIMENTO ADQUIRIDO!',
        html: `Você ganhou <b style="color: #ff007f;">+5 XP</b> por concluir a leitura de: <b>"${articleTitle}"</b>!`,
        background: '#121420',
        color: '#f1f5f9',
        timer: 3000,
        showConfirmButton: false,
        toast: true,
        position: 'bottom-end'
      });
      return true;
    } else {
      rewardedArticlesInMemory.delete(articleId);
    }
    return false;
  }

  async assignBadgeToUser(userId: string, badgeId: string): Promise<boolean> {
    try {
      const userRef = doc(this.firestore, `users/${userId}`);
      const badgeRef = doc(this.firestore, `badges/${badgeId}`);
      
      const [userSnap, badgeSnap] = await Promise.all([
        getDoc(userRef),
        getDoc(badgeRef)
      ]);
      
      if (!userSnap.exists()) return false;
      const userData = userSnap.data() as User;
      const unlocked = userData.unlockedBadges || [];
      if (!unlocked.includes(badgeId)) {
        const newUnlocked = [...unlocked, badgeId];
        const updates: any = { unlockedBadges: newUnlocked };
        
        let rewardAmount = 0;
        if (badgeSnap.exists()) {
          const badgeData = badgeSnap.data() as Badge;
          rewardAmount = badgeData.rewardBits || 0;
        }
        
        if (rewardAmount > 0) {
          updates.bits_balance = (userData.bits_balance || 0) + rewardAmount;
          
          // Log the bits reward
          const logId = 'glog_' + Date.now() + '_badge_bits_' + Math.random().toString(36).substring(2, 7);
          const logRef = doc(this.firestore, `gamification_logs/${logId}`);
          const bitsLog: GamificationLog = {
            id: logId,
            userId,
            typeAction: 'earn',
            amount: rewardAmount,
            description: `Recebeu ${rewardAmount} Bits ao ganhar o emblema: ${badgeSnap.data()?.['name'] || ''}`,
            createdAt: new Date().toISOString()
          };
          await setDoc(logRef, bitsLog);
        }
        
        await updateDoc(userRef, updates);
      }
      return true;
    } catch (err) {
      console.error('Error assigning badge to user:', err);
      return false;
    }
  }

  async removeBadgeFromUser(userId: string, badgeId: string): Promise<boolean> {
    try {
      const userRef = doc(this.firestore, `users/${userId}`);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) return false;
      const userData = userSnap.data() as User;
      const unlocked = userData.unlockedBadges || [];
      if (unlocked.includes(badgeId)) {
        const newUnlocked = unlocked.filter(id => id !== badgeId);
        await updateDoc(userRef, { unlockedBadges: newUnlocked });
      }
      return true;
    } catch (err) {
      console.error('Error removing badge from user:', err);
      return false;
    }
  }

  async checkAndAssignEventBadges(userId: string, todayStr: string, badgesList: Badge[], currentUser: User | null): Promise<boolean> {
    try {
      const userRef = doc(this.firestore, `users/${userId}`);
      const logId = 'glog_' + Date.now() + '_event_auto';
      const logRef = doc(this.firestore, `gamification_logs/${logId}`);

      let activeBadges = badgesList || [];
      if (activeBadges.length === 0) {
        const badgesCol = collection(this.firestore, 'badges');
        const badgesSnap = await getDocs(badgesCol);
        activeBadges = badgesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Badge));
      }

      let eventBadgesForToday: Badge[] = [];
      let totalRewardBits = 0;
      let newUnlocked: string[] = [];
      let eventLogsText = '';

      const resulted = await runTransaction(this.firestore, async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists()) return false;
        const userData = userDoc.data() as User;
        const unlocked = userData.unlockedBadges || [];

        // Filter event badges for today that the user does not have yet
        eventBadgesForToday = activeBadges.filter(b => 
          b.type === 'event' && b.targetDate === todayStr && !unlocked.includes(b.id)
        );

        if (eventBadgesForToday.length === 0) {
          return false;
        }

        newUnlocked = [...unlocked];
        eventLogsText = '';
        totalRewardBits = 0;
        eventBadgesForToday.forEach(b => {
          newUnlocked.push(b.id);
          if (eventLogsText) eventLogsText += ', ';
          eventLogsText += b.name;
          totalRewardBits += b.rewardBits || 0;
        });

        const updates: any = { unlockedBadges: newUnlocked };
        if (totalRewardBits > 0) {
          updates.bits_balance = (userData.bits_balance || 0) + totalRewardBits;
        }
        transaction.update(userRef, updates);

        const eventLog: GamificationLog = {
          id: logId,
          userId,
          typeAction: 'earn',
          amount: totalRewardBits,
          description: `Emblema de evento especial recebido automaticamente: ${eventLogsText}` + (totalRewardBits > 0 ? ` (+${totalRewardBits} Bits)` : ''),
          createdAt: new Date().toISOString()
        };
        transaction.set(logRef, eventLog);
        return true;
      });

      if (!resulted) {
        return false;
      }

      // Show alert if current user
      if (currentUser && userId === currentUser.id) {
        setTimeout(() => {
          eventBadgesForToday.forEach(badge => {
            const bitsText = badge.rewardBits ? ` e ganhou +${badge.rewardBits} Bits` : '';
            Swal.fire({
              title: '🎁 EMBLEMA DE EVENTO!',
              text: `Por logar hoje, você desbloqueou o emblema especial: ${badge.name}${bitsText}!`,
              imageUrl: badge.iconUrl || '/images/default-badge.png',
              imageWidth: 100,
              imageHeight: 100,
              imageAlt: badge.name,
              background: '#121420',
              color: '#f1f5f9',
              confirmButtonText: 'Sensacional!',
              customClass: {
                popup: 'guiik-swal-popup',
                title: 'guiik-swal-title',
                confirmButton: 'guiik-swal-confirm-btn'
              },
              buttonsStyling: false
            });
          });
        }, 1500);
      }

      return true;
    } catch (err) {
      console.error('Erro ao verificar emblemas de evento:', err);
      return false;
    }
  }

  async createShopItem(
    name: string,
    description: string,
    cost: number,
    category: 'frame' | 'tag' | 'theme' | 'other',
    itemValue: string,
    imageUrl?: string
  ): Promise<boolean> {
    try {
      const id = 'shop_' + Date.now();
      const newItem = {
        id,
        name,
        description,
        cost,
        category,
        itemValue,
        imageUrl: imageUrl || '',
        createdAt: new Date().toISOString()
      };
      await setDoc(doc(this.firestore, `shop_items/${id}`), newItem);
      Swal.fire({
        icon: 'success',
        title: 'Item de Loja Criado!',
        text: `O item "${name}" foi cadastrado na Cyber-Shop com sucesso.`,
        background: '#121420',
        color: '#f1f5f9'
      });
      return true;
    } catch (err) {
      console.error('Erro ao criar item de loja:', err);
      Swal.fire('Erro', 'Não foi possível cadastrar o item na loja.', 'error');
      return false;
    }
  }

  async deleteShopItem(itemId: string): Promise<boolean> {
    try {
      await deleteDoc(doc(this.firestore, `shop_items/${itemId}`));
      Swal.fire({
        icon: 'success',
        title: 'Item Excluído',
        text: 'O item cosmético foi removido da Cyber-Shop.',
        background: '#121420',
        color: '#f1f5f9'
      });
      return true;
    } catch (err) {
      console.error('Erro ao excluir item de loja:', err);
      Swal.fire('Erro', 'Não foi possível excluir o item cosmético.', 'error');
      return false;
    }
  }

  async buyShopItem(userId: string, itemId: string): Promise<boolean> {
    try {
      const userRef = doc(this.firestore, `users/${userId}`);
      const itemRef = doc(this.firestore, `shop_items/${itemId}`);
      const logId = 'glog_' + Date.now() + '_buy_' + Math.random().toString(36).substring(2, 7);
      const logRef = doc(this.firestore, `gamification_logs/${logId}`);

      const result = await runTransaction(this.firestore, async (transaction) => {
        const userDoc = await transaction.get(userRef);
        const itemDoc = await transaction.get(itemRef);

        if (!userDoc.exists() || !itemDoc.exists()) {
          throw new Error('Usuário ou item da loja não encontrado.');
        }

        const userData = userDoc.data() as User;
        const itemData = itemDoc.data() as any;

        const purchased = userData.purchasedItems || [];
        if (purchased.includes(itemId)) {
          throw new Error('Você já adquiriu este item cosmético!');
        }

        const cost = itemData.cost || 0;
        const balance = userData.bits_balance || 0;
        if (balance < cost) {
          throw new Error(`Saldo de Bits insuficiente. O item custa ${cost} Bits e você tem ${balance} Bits.`);
        }

        const newPurchased = [...purchased, itemId];
        transaction.update(userRef, {
          bits_balance: balance - cost,
          purchasedItems: newPurchased
        });

        const spendLog: GamificationLog = {
          id: logId,
          userId,
          typeAction: 'spend',
          amount: cost,
          description: `Comprou o item cosmético: ${itemData.name} por ${cost} Bits`,
          createdAt: new Date().toISOString()
        };
        transaction.set(logRef, spendLog);
        return itemData.name;
      });

      if (result) {
        Swal.fire({
          icon: 'success',
          title: '🛍️ ITEM ADQUIRIDO!',
          text: `Você comprou "${result}" com sucesso! Vá ao seu perfil para equipá-lo.`,
          background: '#121420',
          color: '#f1f5f9'
        });
        return true;
      }
      return false;
    } catch (err: any) {
      console.error('Erro ao comprar item cosmético:', err);
      Swal.fire('Erro na Compra', err.message || 'Erro ao realizar a transação.', 'error');
      return false;
    }
  }

  async updateActiveCosmetic(
    userId: string, 
    category: 'frame' | 'tag' | 'theme', 
    itemValue: string
  ): Promise<boolean> {
    try {
      const userRef = doc(this.firestore, `users/${userId}`);
      const updates: any = {};
      if (category === 'frame') {
        updates.activeFrame = itemValue;
      } else if (category === 'tag') {
        updates.activeTag = itemValue;
      } else if (category === 'theme') {
        updates.activeTheme = itemValue;
      }
      await updateDoc(userRef, updates);
      
      Swal.fire({
        icon: 'success',
        title: 'Cosmético Equipado!',
        text: 'Sua customização visual foi alterada com sucesso.',
        background: '#121420',
        color: '#f1f5f9',
        timer: 1500,
        showConfirmButton: false,
        toast: true,
        position: 'top-end'
      });
      return true;
    } catch (err) {
      console.error('Erro ao equipar cosmético:', err);
      Swal.fire('Erro', 'Não foi possível equipar o cosmético.', 'error');
      return false;
    }
  }
}
