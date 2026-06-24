import { Injectable, inject } from '@angular/core';
import { User, BlogSettings, Article, Comment } from '../models/interfaces';
import { Firestore, doc, getDoc, updateDoc, deleteDoc, setDoc } from '@angular/fire/firestore';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private readonly firestore = inject(Firestore);

  async toggleFollow(followedId: string, user: User, followsList: Array<{ followerId: string; followedId: string }>) {
    if (user.id === followedId) return;

    const followId = `${user.id}_${followedId}`;
    const isFollowing = followsList.some(f => f.followerId === user.id && f.followedId === followedId);

    if (isFollowing) {
      await deleteDoc(doc(this.firestore, `follows/${followId}`));
    } else {
      await setDoc(doc(this.firestore, `follows/${followId}`), { followerId: user.id, followedId });
    }
  }

  isFollowing(followedId: string, user: User | null, followsList: Array<{ followerId: string; followedId: string }>): boolean {
    if (!user) return false;
    return followsList.some(f => f.followerId === user.id && f.followedId === followedId);
  }

  async registerBlogView(userId: string) {
    if (typeof window === 'undefined') return;
    try {
      const res = await fetch('https://api.ipify.org?format=json');
      const data = await res.json();
      const ip = data.ip;
      if (!ip) return;

      const safeIp = ip.replace(/\./g, '_').replace(/:/g, '_');
      const viewId = `${userId}_${safeIp}`;

      const viewRef = doc(this.firestore, `blog_views/${viewId}`);
      const viewSnap = await getDoc(viewRef);

      if (!viewSnap.exists()) {
        await setDoc(viewRef, { userId, ip, timestamp: new Date().toISOString() });
        
        const userRef = doc(this.firestore, `users/${userId}`);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const userData = userSnap.data() as User;
          const newCount = (userData.viewsCount || 0) + 1;
          await updateDoc(userRef, { viewsCount: newCount });
        }
      }
    } catch (err) {
      console.warn('Failed to register blog view', err);
    }
  }

  async updateBlogSettings(settings: BlogSettings, user: User, updateLocalUserFn: (settings: BlogSettings) => void) {
    await updateDoc(doc(this.firestore, `users/${user.id}`), {
      blogSettings: { ...settings }
    });
    updateLocalUserFn(settings);
  }

  async updateProfile(
    displayName: string, 
    bio: string, 
    avatarUrl: string, 
    username: string | undefined, 
    user: User,
    usersList: User[],
    articlesList: Article[],
    commentsList: Comment[],
    updateLocalProfileFn: (displayName: string, bio: string, avatarUrl: string, cleanUsername: string) => void
  ): Promise<boolean | string> {
    let cleanUsername = user.username;
    if (username) {
      cleanUsername = username.toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (!cleanUsername) {
        return 'username_invalid';
      }
      
      const isTaken = usersList.some(u => u.username === cleanUsername && u.id !== user.id);
      if (isTaken) {
        return 'username_taken';
      }
    }

    const usernameChanged = cleanUsername !== user.username;
    const nameChanged = displayName !== user.displayName;
    const avatarChanged = avatarUrl !== user.avatarUrl;

    await updateDoc(doc(this.firestore, `users/${user.id}`), {
      displayName,
      bio,
      avatarUrl,
      username: cleanUsername
    });

    if (usernameChanged || nameChanged || avatarChanged) {
      const userArticles = articlesList.filter(art => art.authorId === user.id);
      for (const art of userArticles) {
        await updateDoc(doc(this.firestore, `articles/${art.id}`), {
          authorUsername: cleanUsername,
          authorDisplayName: displayName,
          authorAvatarUrl: avatarUrl
        });
      }

      const userComments = commentsList.filter(c => c.authorId === user.id);
      for (const c of userComments) {
        await updateDoc(doc(this.firestore, `comments/${c.id}`), {
          authorUsername: cleanUsername,
          authorDisplayName: displayName,
          authorAvatarUrl: avatarUrl
        });
      }
    }

    updateLocalProfileFn(displayName, bio, avatarUrl, cleanUsername);
    return true;
  }

  async addCollaborator(
    usernameToAdd: string, 
    user: User, 
    usersList: User[],
    updateLocalCollabsFn: (collabs: string[]) => void
  ): Promise<boolean | string> {
    const cleanUsername = usernameToAdd.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const userToAdd = usersList.find(u => u.username === cleanUsername);
    if (!userToAdd) return 'not_found';
    if (userToAdd.id === user.id) return 'self';

    const currentCollabs = user.collaborators || [];
    if (currentCollabs.includes(userToAdd.id)) return 'already_added';

    const newCollabs = [...currentCollabs, userToAdd.id];
    
    await updateDoc(doc(this.firestore, `users/${user.id}`), {
      collaborators: newCollabs
    });

    updateLocalCollabsFn(newCollabs);
    return true;
  }

  async removeCollaborator(collaboratorId: string, user: User, updateLocalCollabsFn: (collabs: string[]) => void) {
    const currentCollabs = user.collaborators || [];
    const newCollabs = currentCollabs.filter(id => id !== collaboratorId);
    
    await updateDoc(doc(this.firestore, `users/${user.id}`), {
      collaborators: newCollabs
    });

    updateLocalCollabsFn(newCollabs);
  }

  async updateUserRole(userId: string, role: 'admin' | 'creator'): Promise<boolean> {
    try {
      const userRef = doc(this.firestore, `users/${userId}`);
      await updateDoc(userRef, { role });
      return true;
    } catch (err) {
      console.error('Erro ao atualizar cargo:', err);
      return false;
    }
  }
}
